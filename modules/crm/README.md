# CRM module

## What it is responsible for

Customers, the contacts at each customer and the roles that decide who receives which mail, the credit-hold flag, and the defaults and parts kept per customer. Quoting reads this data to start and price a quote, and orders reads it to address an order confirmation. Neither imports this module. The API composition root wires them to it through their own ports ([docs/decisions/001-modular-monorepo.md](../../docs/decisions/001-modular-monorepo.md)).

## Public surface

Everything other code may use is exported from [src/index.ts](src/index.ts). Only `apps/api` imports it.

- `CustomerService`, `ContactService` and `CustomerDefaultsService`. Expected refusals come back as result objects such as `{ ok: false, reason: 'wrong-customer' }`. Role checks are not made here. They sit on the routes in [apps/api/src/crm/](../../apps/api/src/crm/).
- The repository ports, their row shapes and the adapter errors, from [src/ports.ts](src/ports.ts).
- An in-memory and a Drizzle adapter for each port, and `createCrmDb`. The API factory [apps/api/src/crm/crm.factory.ts](../../apps/api/src/crm/crm.factory.ts) picks one set by the storage mode ([docs/decisions/007-persistence-switch-at-the-composition-root.md](../../docs/decisions/007-persistence-switch-at-the-composition-root.md)).

The Drizzle tables in `src/data/schema.ts` and the role helpers in `src/contact-roles.ts` are not exported. No other module may read the `crm` tables.

## State it owns

The PostgreSQL schema `crm`, created by [infra/db/migrations/crm/0000_baseline.sql](../../infra/db/migrations/crm/0000_baseline.sql):

- `customers`: terms, tax, billing and shipping address, account rep, and the credit-hold flag with who set it and when.
- `contacts`: name, email and phone, with a generated `contact_reach` column derived from which of email and phone are present.
- `contact_roles`: the roles a contact holds (`quote`, `order_confirmation`, `production`) with who set each and when.
- `customer_defaults` and `customer_parts`: defaults for new quote lines, and the customer's parts by grade and width, each with an optional agreed price.

There is no state machine. Customers, contacts and customer defaults each carry a `lockVersion`. Every write checks the version the caller read and moves it on ([docs/decisions/006-optimistic-concurrency.md](../../docs/decisions/006-optimistic-concurrency.md)). Customer defaults start at version 0, meaning nothing has been saved yet.

## Rules it enforces

- A quote goes only to contacts tagged `quote`. This module owns that tag ([docs/product/requirements.md](../../docs/product/requirements.md), R1).
- A mail role (`quote`, `order_confirmation`) needs an email address, and `production` needs an email address or a phone. The service refuses a new role a contact cannot be reached for, and gives up a held role when the address it needs is removed. The database holds the same rule through a composite foreign key on `contact_reach` and `contact_roles_reachable_check`.
- A customer's first contact with an email address takes the mail roles while no other contact holds one.
- `CustomerService.mayQuote` answers false for a customer on credit hold, and for an unknown customer. Quoting calls it when a quote is created ([docs/product/requirements.md](../../docs/product/requirements.md), R2). The single-use exception belongs to quoting.
- Only Billing and Admin may set or clear the hold. That gate is on the route in [apps/api/src/crm/crm.controller.ts](../../apps/api/src/crm/crm.controller.ts) (R2).
- Money and rates are `numeric` columns read as strings ([docs/decisions/003-decimal-arithmetic.md](../../docs/decisions/003-decimal-arithmetic.md)).

## Where to start reading

- [src/ports.ts](src/ports.ts): the three repository contracts and what each write promises.
- [src/services/contact-service.ts](src/services/contact-service.ts): contact roles and the reach rule, the densest logic here.
- [src/services/customer-service.ts](src/services/customer-service.ts): customers, the credit hold and `mayQuote`.
- [src/adapters/drizzle/drizzle-contact-repository.ts](src/adapters/drizzle/drizzle-contact-repository.ts): why role rows are written in a set order.
- [infra/db/migrations/crm/0000_baseline.sql](../../infra/db/migrations/crm/0000_baseline.sql): the CHECK constraints that back the rules.

## Tests

- Contract suites in [test/contracts/](test/contracts/) hold each port's promises once. The `*.contract.test.ts` files run them against the in-memory adapter and, when a database is available, the Drizzle adapter.
- Service tests run the services on in-memory adapters.
- Schema tests check the shared request schemas from `packages/types` for customers and contacts.
- `*.db.test.ts` and `crm-database.test.ts` run SQL against the migrated schema to prove the constraints and SQLSTATE translation.

`pnpm test` runs everything that needs no database and skips the database suites. `pnpm test:db` runs the same suite against a throwaway local Postgres.
