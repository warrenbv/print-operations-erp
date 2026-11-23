# Orders module

## What it is responsible for

The order created from an accepted quote. It keeps its own copy of the quote's lines at the quoted prices and the customer's PO, moves from converted to confirmed when Production or the Production Manager confirms it, and takes a job number from a database sequence at that moment. It also decides when an order confirmation may be sent and who is told that a new order is waiting.

## Public surface

Everything other code may use is exported from [src/index.ts](src/index.ts). Only `apps/api` imports it.

- `OrderService`, the one entry point for conversion, confirmation, the PO, totals, history and the queue views.
- The ports from [src/ports.ts](src/ports.ts). `QuoteLookup` is how orders asks quoting for a convertible quote, in a line shape orders declares itself. `CustomerRecipients`, `ProductionManagerRecipients` and the two notifier ports are how it reaches crm, identity and mail. The API fills them in [apps/api/src/orders/orders.factory.ts](../../apps/api/src/orders/orders.factory.ts).
- `orderTotals`, `formatJobNumber`, `InvalidOrderTransitionError` and the errors in `ports.ts`, which the API maps to HTTP replies.
- `InMemoryOrderRepository`, `DrizzleOrderRepository` and `createOrdersDb`. The factory picks one by the storage mode ([docs/decisions/007-persistence-switch-at-the-composition-root.md](../../docs/decisions/007-persistence-switch-at-the-composition-root.md)).

Role checks are not made here. They are on the routes in [apps/api/src/orders/orders.controller.ts](../../apps/api/src/orders/orders.controller.ts). No other module may read the `orders` tables.

## State it owns

The PostgreSQL schema `orders`, created by [infra/db/migrations/orders/0000_baseline.sql](../../infra/db/migrations/orders/0000_baseline.sql):

- `orders`: the quote and customer it came from, status, PO number with who recorded it and when, requested date, and the confirmation record (job number, committed lead time, who confirmed and when).
- `order_lines`: the goods and committed money copied from each quote line, with the quote line's id kept.
- `order_transitions`: one row per status change, with the actor.
- The sequence `orders.job_number_seq`.

The state machine is defined in `ORDER_TRANSITIONS` in [packages/types/src/order.ts](../../packages/types/src/order.ts) and guarded by [src/order-state-machine.ts](src/order-state-machine.ts):

| From        | To          | Who                                         |
| ----------- | ----------- | ------------------------------------------- |
| none        | `converted` | Any signed-in user, by converting a quote   |
| `converted` | `confirmed` | Production, the Production Manager or Admin |

`confirmed` is final in this journey. Every write moves `lockVersion`, and confirmation and PO capture check the version the caller read ([docs/decisions/006-optimistic-concurrency.md](../../docs/decisions/006-optimistic-concurrency.md)).

## Rules it enforces

- The order copies the quote's lines at the quoted prices and is never repriced from quoting afterwards ([docs/product/requirements.md](../../docs/product/requirements.md), R9). The order keeps the facts and points back to how they were derived by quote line id ([docs/decisions/002-what-crosses-a-module-boundary.md](../../docs/decisions/002-what-crosses-a-module-boundary.md)).
- Conversion has no role gate, and the converter and PO recorder are the session user (R10).
- Conversion writes each order with its lines, its opening history row and its PO number in one write, all or none, whether it makes one order or several.
- Only a `quoted` quote that still passes the checks a send makes converts: no line below the floor without an override, a live approval for every hand-set price, and a lead time (R5, R6, R7). `QuoteLookup` answers null for a quote in another status and throws `QuoteFailsSendChecksError` for one that fails a check. The API fills it from quoting's `printableQuote` in [apps/api/src/orders/orders.factory.ts](../../apps/api/src/orders/orders.factory.ts).
- Confirmation commits a lead time in calendar days and mints the job number (R11, and [docs/product/decisions.md](../../docs/product/decisions.md)).
- A confirmation record is written whole or not at all, and a PO number is stored with who recorded it. CHECK constraints in the baseline hold both.
- Money stays decimal end to end, and totals add each line's amount rounded to cents ([docs/decisions/003-decimal-arithmetic.md](../../docs/decisions/003-decimal-arithmetic.md)).

## Where to start reading

- [src/services/order-service.ts](src/services/order-service.ts): conversion, confirmation and the PO.
- [src/ports.ts](src/ports.ts): what orders asks of other modules and what a repository promises.
- [src/order-state-machine.ts](src/order-state-machine.ts): the transition guard.
- [src/adapters/drizzle/drizzle-order-repository.ts](src/adapters/drizzle/drizzle-order-repository.ts): the transactions and the job number sequence.
- [apps/api/src/orders/orders.factory.ts](../../apps/api/src/orders/orders.factory.ts): the field-by-field mapping from quote line to order line.

## Tests

- [test/contracts/order-repository.contract.ts](test/contracts/order-repository.contract.ts) holds the repository's promises once. [test/repository-contracts.test.ts](test/repository-contracts.test.ts) runs it against both adapters, and adds database-only checks of the CHECK constraints and the sequence.
- `order-service.test.ts` covers conversion, confirmation, the PO, notifications and stale writes on the in-memory adapter.
- `order-state-machine.test.ts` and `order-totals.test.ts` cover the pure functions.

`pnpm test` runs everything that needs no database and skips the database suites. `pnpm test:db` runs the same suite against a throwaway local Postgres.
