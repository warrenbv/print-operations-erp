# Database package

## What it is responsible for

`@erp/db` is the shared database plumbing every module and the API use. It creates connection pools, gives each module a Drizzle handle typed to its own schema, runs each module's migrations with a history of its own, and gives each module's database tests a database of their own. It holds no business tables.

## Public surface

Other code imports only from `@erp/db`, which is [src/index.ts](src/index.ts):

- `createPool` and `createModuleDb`: a pool from `DATABASE_URL`, and a handle bound to one module's schema object.
- `newId`: application-generated UUIDv7 keys.
- `StaleAggregateError`: the error a repository throws when the caller's `lockVersion` is out of date.
- The SQLSTATE constants and predicates such as `isUniqueViolation`, which see through Drizzle's wrapped errors.
- `runModuleMigrations`, `migrationsTableFor`, `MIGRATIONS_SCHEMA` and `MIGRATIONS_ROOT`.
- `moduleTestDatabase` and `dropTestDatabase`, for tests only.

It may import other packages only, never a module: [packages/config/eslint/boundaries.mjs](../config/eslint/boundaries.mjs).

## State it owns

The `drizzle` schema, which holds one migration history table per module, named `__migrations_<module>`. The modules' own schemas belong to the modules. Their migrations are in [infra/db/migrations/](../../infra/db/migrations/), one folder per module.

## Rules it enforces

- Each module owns one PostgreSQL schema and its own migration history: [docs/decisions/010-orm-spike.md](../../docs/decisions/010-orm-spike.md).
- Keys are UUIDv7 generated in the application: [docs/decisions/010-orm-spike.md](../../docs/decisions/010-orm-spike.md).
- A decision made on stale figures is refused with one distinct error, which the API turns into HTTP 409: [docs/decisions/006-optimistic-concurrency.md](../../docs/decisions/006-optimistic-concurrency.md).
- Modules share this plumbing through a package and never through each other: [docs/decisions/001-modular-monorepo.md](../../docs/decisions/001-modular-monorepo.md).
- Whether a process uses PostgreSQL or memory is decided by the API, not here. This package only connects when asked: [docs/decisions/007-persistence-switch-at-the-composition-root.md](../../docs/decisions/007-persistence-switch-at-the-composition-root.md).

## Where to start reading

- [src/migrator.ts](src/migrator.ts): where each module's history is kept and why.
- [src/module-db.ts](src/module-db.ts): the handle typed to one module's schema.
- [src/stale-aggregate.ts](src/stale-aggregate.ts): the optimistic-concurrency error.
- [src/testing.ts](src/testing.ts): per-module test databases, and teardown that never fails a suite.
- [src/cli/migrate.ts](src/cli/migrate.ts): applying every module's migrations from the command line.

## Tests

- Unit tests for SQLSTATE detection through wrapped errors, and for how the migrations folder is found.
- Migration tests apply two modules into their own schemas against a real Postgres and check that the histories stay separate and re-runs apply nothing. They run only with `DATABASE_URL`.
- Teardown tests for the test-database helper run only with `DATABASE_URL`.

`pnpm test` runs the package's tests with no database, and the migration and teardown tests skip. `pnpm test:db` runs them all against a throwaway local Postgres from [scripts/test-db.mjs](../../scripts/test-db.mjs).
