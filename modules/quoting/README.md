# Quoting

## What it is responsible for

Quoting prices rolls of paper for a customer and carries the quote from draft to sent. It owns the price build-up (grade cost, waste, hardware, add-ons, pricing tier, margin floor and freight), the quote state machine, the two controls on a send (the hand-set price approval and the margin floor), the lead time Production enters, and the record of every send. It also keeps the reference data pricing depends on: paper grades, pricing configuration, pricing tiers, pallet fits and imported tax rates. It also finds the tax jurisdiction of a delivery address through an external lookup.

## Public surface

- Other code imports `@erp/quoting`, which is [`src/index.ts`](src/index.ts), and never a path under `src/`. The boundary is [docs/decisions/001-modular-monorepo.md](../../docs/decisions/001-modular-monorepo.md). Request and response shapes live in `packages/types`.
- The exports are the services, the pure pricing functions, the state-machine helpers, the ports and errors in [`src/ports.ts`](src/ports.ts), and both adapter sets with their seed constants.
- No other module imports quoting. The API wires it in `apps/api/src/quoting/quoting.factory.ts` and chooses the adapters there: [docs/decisions/007-persistence-switch-at-the-composition-root.md](../../docs/decisions/007-persistence-switch-at-the-composition-root.md).
- What quoting needs from other modules is declared as ports in its own terms and supplied by the API: `CustomerLookup`, `OrderLookup`, `QuoteNotifier`, `ProductionManagerRecipients`, `ProductionManagerNotifier`, `LeadTimeRequestLog`, `TaxJurisdictionLookup` and `TaxCodeLookup`.
- The services do not check roles. The API guards each route, for example `apps/api/src/quoting/quotes.controller.ts`.

## State it owns

The PostgreSQL schema `quoting`, defined in [`src/data/schema.ts`](src/data/schema.ts) and created by `infra/db/migrations/quoting/0000_baseline.sql`: grades with their footages and stock widths, pricing configuration and its change log, pricing tiers and their change log, pallet fits, quotes, quote lines, override decisions, sends, credit-hold exceptions (`quote_approvals`) and tax rates. Customer ids are stored without a foreign key, because customers belong to the CRM module.

The quote state machine. The table is `QUOTE_TRANSITIONS` in `packages/types/src/quote.ts`, and [`src/quote-state-machine.ts`](src/quote-state-machine.ts) enforces it.

| From                                    | To                   | Who moves it                                                                                                              |
| --------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `draft`                                 | `override_requested` | Sales asks for a price approval or a floor override                                                                       |
| `draft`, `override_requested`           | `quoted`             | Sales sends, once every condition is met                                                                                  |
| `override_requested`                    | `draft`              | A rejection, an approval that leaves nothing owed, a line edit that revokes an approval, or Sales withdrawing the request |
| `draft`, `override_requested`, `quoted` | `closed_lost`        | Sales, unless the quote has an order                                                                                      |
| `quoted`                                | `superseded`         | Sales revises, which creates the next version as a new `draft`                                                            |

`superseded` and `closed_lost` are final. Lines can change only in `draft` and `override_requested`, decided from the row the line save writes. Only `quoted` converts to an order.

One move is not in the table. A first send that fails before the relay accepts the email puts the quote back from `quoted` to the status it had, `draft` or `override_requested`, at the version the send's move wrote.

## Rules it enforces

- A quote needs a known customer, and a send with no recipients is refused: [docs/product/requirements.md](../../docs/product/requirements.md) (R1).
- A credit hold blocks creation and revision. An approved exception is spent by exactly one new quote, in the same transaction (R2).
- Each line is priced from the grade cost, waste, hardware and the pricing tier, and the build-up is stored on the line (R3).
- Freight is priced by shipping mode, kept apart from the roll price, and stays pending until a carrier bid is entered (R4).
- A quote with no lead time cannot be sent or printed (R5).
- A line below the margin floor blocks the send. Only an Admin floor override releases it, and a line edit revokes the override. Freight margin is not counted (R6).
- A hand-set price needs a live Billing Manager approval. A line edit revokes it and returns the quote to draft (R7, [docs/decisions/006-optimistic-concurrency.md](../../docs/decisions/006-optimistic-concurrency.md)).
- Every write to a quote or grade bumps `lockVersion`, and a write given a stale one fails with `StaleAggregateError`. The service refuses a caller's `lockVersion` that differs from the version it read, so each check it makes holds for the version that is written. An approval that leaves nothing owed, or any rejection, moves the quote to draft in the write that records it, at the version the decider was shown. A decision is taken only in `draft` or `override_requested`: [docs/decisions/006-optimistic-concurrency.md](../../docs/decisions/006-optimistic-concurrency.md).
- A send moves the quote to `quoted` before the document renders. A failure to read the moved quote or to render it, or an email the relay does not accept, puts the quote back in its earlier status, written at the version the move wrote. A quote that gained an order meanwhile stays `quoted`, and so does one whose undo cannot be written, for instance because another write has moved it on. Either outcome fails the send with `QuoteSendNotUndoneError`. Once the relay accepts the email the quote stays sent. A send record that cannot then be written fails the send with `QuoteSendNotRecordedError`, which carries the record.
- The API serves and emails a stored copy of the quote document only when the copy was rendered at or after the last change to the lines, the freight setting or the lead time. Otherwise it renders a new one, so a copy rendered for a refused send is not used once the quote is edited.
- A revision supersedes the original and inserts the next version in one write. The write refuses an original that is no longer `quoted` or no longer at the version the service read, and then writes nothing.
- Money and rates are decimal strings, computed with `big.js` and serialised at the column's scale: [docs/decisions/003-decimal-arithmetic.md](../../docs/decisions/003-decimal-arithmetic.md).

## Where to start reading

- [`src/services/quote-service.ts`](src/services/quote-service.ts): every act on a quote and the checks before a send.
- [`src/quote-calculation.ts`](src/quote-calculation.ts): one line's price, margin and floor result.
- [`src/cost-build-up.ts`](src/cost-build-up.ts): the cost of one roll.
- [`src/ports.ts`](src/ports.ts): the repository ports, the cross-module ports and the domain errors.
- [`src/adapters/drizzle/drizzle-quote-repository.ts`](src/adapters/drizzle/drizzle-quote-repository.ts): the guarded writes behind the quote port.
- [`test/contracts/quote-repository.contract.ts`](test/contracts/quote-repository.contract.ts): what both quote adapters promise.

## Tests

- Unit tests run the services and pricing functions on the in-memory adapters. They prove the business rules above and the price arithmetic, including synthetic examples with worked expected figures.
- Contract suites in [`test/contracts/`](test/contracts/) hold one set of assertions per port. `test/repository-contracts.test.ts` and `test/tax-rate-contracts.test.ts` run them against both adapters, so a disagreement between the two fails a test.
- `test/quoting-database.test.ts` checks the schema's constraints against PostgreSQL.
- `pnpm test` runs everything that needs no database. The Drizzle contract runs and the database tests are skipped there. `pnpm test:db` runs the same suite against a throwaway local PostgreSQL, so they run too.
