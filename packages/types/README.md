# @erp/types

## What it is responsible for

The shared contract layer. Every module and both applications take their cross-boundary types from here: Zod schemas with the TypeScript types inferred from them, the decimal scalars for money, rates and measures, the role names and role lists, the status lists and state transitions, and the request and response shapes of the API. Nothing else crosses a module boundary. See [001](../../docs/decisions/001-modular-monorepo.md) and [002](../../docs/decisions/002-what-crosses-a-module-boundary.md).

Some contracts carry small pure functions, where two sides must compute the same answer: decimal parsing and formatting, the margin-floor verdict, recipient selection, calendar-day arithmetic and the tax-rate import parser.

## Public surface

- Import from `@erp/types` only. [`src/index.ts`](src/index.ts) re-exports every file. The lint rule in [`packages/config/eslint/boundaries.mjs`](../config/eslint/boundaries.mjs) refuses imports of any package's `src/` internals.
- The package depends on `zod` and `big.js`, and on no module or application. It does no I/O and reads no environment.
- Decimals cross every boundary as strings. Parse with `toDecimal`, compute on `Decimal`, and serialise with `toMoney`, `toRate`, `toMeasure` or `toUnitCost` at the kind's scale. `toDecimal` throws on a JavaScript number. See [003](../../docs/decisions/003-decimal-arithmetic.md).
- Display helpers such as `formatMoney` round for reading only. A value going back to storage keeps its column scale.
- The wording of every validation refusal is set once in [`src/validation-messages.ts`](src/validation-messages.ts), which the entry loads before any schema. A message written on a check wins over it. The API returns these sentences in its 400 bodies and the web forms show them, and [`apps/web/src/lib/api-error.ts`](../../apps/web/src/lib/api-error.ts) reads `Required` as a missing field. The body of a refused request, `{ formErrors, fieldErrors }`, is part of the API's contract, and `refusalBody` in the same file produces it.

## State it owns

None at runtime. It defines lists that the database baselines repeat as CHECK constraints, so a change to one of these lists needs a migration beside it:

| Lists                                                                                                                                                                                                                                          | Baseline                                                                                                           |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `QUOTE_STATUSES`, `PRICE_SOURCES`, `PRICING_BASES`, `SHIPPING_MODES`, `REVENUE_CATEGORIES`, `TAX_STATUSES`, `QUOTE_OVERRIDE_DECISIONS`, `QUOTE_OVERRIDE_KINDS`, `QUOTE_APPROVAL_STATUSES`, `PRODUCT_FAMILIES`, `TAX_RATE_SOURCES`, tier source | [`infra/db/migrations/quoting/0000_baseline.sql`](../../infra/db/migrations/quoting/0000_baseline.sql)             |
| `ORDER_STATUSES`, `PRICING_BASES`, `SHIPPING_MODES`, `REVENUE_CATEGORIES`, `TAX_STATUSES`                                                                                                                                                      | [`infra/db/migrations/orders/0000_baseline.sql`](../../infra/db/migrations/orders/0000_baseline.sql)               |
| `CONTACT_ROLES`, `PRICING_BASES`, `SHIPPING_MODES`                                                                                                                                                                                             | [`infra/db/migrations/crm/0000_baseline.sql`](../../infra/db/migrations/crm/0000_baseline.sql)                     |
| `DOCUMENT_KINDS`, `DOCUMENT_SOURCES`, `DOCUMENT_SUBJECT_TYPES`, `RECEIVED_CONTENT_TYPES`                                                                                                                                                       | [`infra/db/migrations/documents/0000_baseline.sql`](../../infra/db/migrations/documents/0000_baseline.sql)         |
| `SEND_SUBJECT_TYPES`, `SEND_AUDIENCES`, `SEND_KINDS`, `SEND_OUTCOMES`, `SEND_FAILURE_REASONS`                                                                                                                                                  | [`infra/db/migrations/notifications/0000_baseline.sql`](../../infra/db/migrations/notifications/0000_baseline.sql) |

`DECIMAL_SCALES` and `DECIMAL_PRECISION` match the `numeric` column types in the same baselines. `ERP_ROLES` has no CHECK constraint. The identity schema stores roles as a text array.

Two state machines are declared here and enforced by the owning module:

- Quote, in `QUOTE_TRANSITIONS`: `draft`, `override_requested`, `quoted`, `superseded`, `closed_lost`. Asking for a price approval moves a draft to `override_requested`, and the Billing Manager's decision returns it to `draft`. Sending moves it to `quoted`. Revising a quoted quote supersedes it. Enforced in [`modules/quoting/src/quote-state-machine.ts`](../../modules/quoting/src/quote-state-machine.ts) and the quote service.
- Order, in `ORDER_TRANSITIONS`: `converted`, then `confirmed`. Conversion creates it and Production or the Production Manager confirms it. Enforced in [`modules/orders/src/order-state-machine.ts`](../../modules/orders/src/order-state-machine.ts).

## Rules it enforces

- Money and rates are strings at a fixed scale, with half-up rounding stated in code. [003](../../docs/decisions/003-decimal-arithmetic.md)
- A write is refused when a figure would overflow its `numeric` column (`withinColumn`).
- The minimum price that clears the margin floor is rounded up, so the quoted minimum is never below the floor. [R6](../../docs/product/requirements.md)
- Who may do what is one list per act in [`src/roles.ts`](src/roles.ts): lead time ([R5](../../docs/product/requirements.md)), floor override ([R6](../../docs/product/requirements.md)), price approval ([R7](../../docs/product/requirements.md)), credit hold ([R2](../../docs/product/requirements.md)) and order confirmation ([R11](../../docs/product/requirements.md)). The API guards and the web pages read the same lists.
- A quote goes only to contacts tagged for quotes (`recipientAddressesFor`). [R1](../../docs/product/requirements.md)
- A floor override needs a reason. A taxable line names a jurisdiction and a non-taxable one does not. [R6](../../docs/product/requirements.md), [R4](../../docs/product/requirements.md)
- Every aggregate a person decides on carries `lockVersion`. [006](../../docs/decisions/006-optimistic-concurrency.md)

## Where to start reading

- [`src/decimal.ts`](src/decimal.ts): the scalars, the scales and the only arithmetic type.
- [`src/roles.ts`](src/roles.ts): the role catalogue and the role list behind each act.
- [`src/quote.ts`](src/quote.ts) and [`src/quote-calculation.ts`](src/quote-calculation.ts): the quote, its lines, its state machine and the floor verdict.
- [`src/order.ts`](src/order.ts): the order, its lines copied from the quote, and conversion.
- [`src/contact.ts`](src/contact.ts): contact tags and recipient selection.

## Tests

Unit tests in `test/` run each schema and helper on its own, with no database. Most prove what a schema accepts and refuses. `roles.test.ts` classifies every exported role list and fails when a read gate stops admitting every role, because reading is open to every signed-in user ([roles](../../docs/product/roles.md)). `column-ceilings.test.ts` proves that the write shapes refuse a figure their column cannot hold. `tax-rate-import.test.ts` parses two sample rate releases in `test/fixtures/`. `validation-messages.test.ts` pins the exact sentence for every kind of refusal and the shape of the refusal body.

Run them with `pnpm test` (every package, no database) or `pnpm test:db` (the same suite against a throwaway local Postgres).
