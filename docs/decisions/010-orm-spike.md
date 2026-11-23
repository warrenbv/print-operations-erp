# 010. Drizzle, UUIDv7 keys and money as `numeric`, from a spike

Status: Accepted. Decided by Warren Vogel, project owner and acting technical lead.

## Context

No schema could land until an ORM and migration tool were chosen, and it was the last hard blocker on the first sprint. The database record had narrowed the field to Prisma or Drizzle.

Two commitments in the data architecture constrained the choice more than ergonomics did:

- **Schema per module.** Each module owns a PostgreSQL schema and touches only its own. Cross-module needs go through the owning module's contract, not a join.
- **Per-module migrations**, versioned under `infra/db/migrations`.

Both exist so a module can be lifted elsewhere in the business, or extracted into a service, years later. So the question for the spike was not which ORM is nicer to write. It was whether the module boundary would be enforced by the compiler or policed in review forever. Two conventions were parked on the same record: UUID or serial keys, and how money is stored.

## The spike

Both stacks were built against a real PostgreSQL 18.4, with a `crm` schema holding customers, an `orders` schema holding orders, per-module migrations, and sub-cent money. The versions were Drizzle 0.45.2, drizzle-kit 0.31.10 and Prisma 7.8.0, with strict TypeScript.

- **The boundary.** Orders code reading CRM's customers failed to compile with Drizzle: `Property 'customers' does not exist` on the orders client. With Prisma it compiled clean. Prisma generates one client carrying every model, so reaching another module's table needs no import.
- **The honest limit.** Drizzle is not a seal. A query compiles if you import CRM's table object. But that import is visible in the diff and bannable by lint. With Prisma there is nothing to catch.
- **Migrations.** Drizzle produced a migration folder and a history table per module. Prisma produced one file with both schemas and one shared history.
- **Money was not a discriminator.** Neither returned a float. Drizzle returned the string `"0.148750"`. Prisma returned a `Decimal` with arithmetic built in, which is if anything better.
- **Prisma beat its reputation.** Multi-schema support is generally available. The problem was the single client and history.

## Decision

Use Drizzle with drizzle-kit. The boundary decided it, the per-module history second.

- **Keys:** UUIDv7 everywhere, generated in the application. An order can be built in memory before touching the database, and time ordering keeps index locality.
- **Money:** `numeric(19,4)` for amounts and `numeric(9,6)` for rates and margins, read as strings. Prices are per roll from measured weights, and the margin floor blocks quotes, so a wrong rounding could approve a quote the business meant to stop.

## Alternatives considered

- **Prisma.** Better developer experience, a larger ecosystem, a real `Decimal`, and more prevalent in AI training data, which mattered for an AI-assisted codebase. Rejected because one client and one history fight the architecture.
- **Raw SQL and a migration runner.** Rejected because it rebuilds type-safe queries by hand and loses the compile-time boundary.

## Consequences

- The boundary is enforced by `tsc`. Migrations are plain SQL with no codegen step.
- Slower initial velocity, a smaller ecosystem, fewer developers who know it, and no decimal type, later settled in 003.
- The import-boundary lint rule became load-bearing.
- drizzle-kit's bare `CREATE SCHEMA` collided with bookkeeping kept in the module's schema, so bookkeeping moved to a dedicated `drizzle` schema. The spike found this the hard way.

## Where to see it

- [`packages/db/src/module-db.ts`](../../packages/db/src/module-db.ts): the handle typed to one module's schema.
- [`packages/db/src/ids.ts`](../../packages/db/src/ids.ts): application-generated UUIDv7.
- [`infra/db/migrations/`](../../infra/db/migrations/): one folder per module.
- [`packages/config/eslint/boundaries.mjs`](../../packages/config/eslint/boundaries.mjs): the lint rule.
