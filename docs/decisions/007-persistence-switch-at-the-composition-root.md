# 007. The storage choice lives at the composition root

Status: Accepted. Decided by Warren Vogel, project owner.

## Context

Every module has an in-memory adapter and a PostgreSQL adapter behind the same ports. One small piece of code decides which the running application uses. It reads two environment variables and refuses to start a production process on in-memory storage, because nothing written there would survive a restart.

That code lived in the identity module, although it was not identity's decision. Every caller was an API factory choosing storage for its own module. Identity was one caller among many.

The cost had already shown up. The environment variable was named after identity, and Warren lost a manual verification pass because the API had been started in memory mode. Rows seeded into PostgreSQL were invisible, and the database showed no connection at all. The variable was renamed to `DATA_PERSISTENCE`, but the code stayed where it was.

The record states plainly that this was not a lint violation. Apps may import modules, so the factories' imports were legal. The problems were narrower:

- A bounded context owned a decision that belongs to the application.
- If any module ever needed the mode, the import would become module to module, which the boundary rule refuses.
- The refusal message read as identity's policy for a rule that governs every module's storage.

## Decision

Move the guard to the composition root, `apps/api/src/config/`, and move the `PersistenceMode` type to `packages/types`. Identity keeps working unchanged, because the only thing it needs is the type.

Make the move in one change with every import repointed and no compatibility re-export. The type checker proves the mechanical half, since a missed call site does not compile.

## Alternatives considered

- **`packages/config`.** The name fits and the contents do not. That package holds build-tool presets for lint, formatting and tests, with no runtime TypeScript. Putting runtime code there would change what the package is.
- **`packages/utils`.** The functions are pure, which meets that package's bar, but its charter is helpers with no business meaning. A guard that can refuse to boot the application is policy.
- **A new package.** Conceptually the cleanest home, but a whole package for a small file with one app using it is premature. It is recorded as the upgrade path if a second composition root, such as a CLI or worker, ever needs the mode.
- **Leave it in identity with a comment.** Free and legal, but it keeps the wrong owner and the misleading message.
- **`packages/types`.** Considered only to reject it. That package carries domain contracts, some with behaviour. A boot-time environment guard is infrastructure policy about one process. The type goes there, the guard does not.

No re-export bridge was kept. The earlier variable rename kept the old name working for a release because deployed machines hold their environment files outside the repository. An import path is inside the repository and checked by the compiler, so a bridge would only leave two ways to import one thing.

## Consequences

- The storage decision lives with every other wiring decision.
- `apps/api` gains a `config/` folder, which future boot concerns will gather in.

## In this edition

The demo launcher sets `DATA_PERSISTENCE` to memory mode, so the demo never uses the PostgreSQL adapters. `pnpm test:db` exercises them: it starts a throwaway local PostgreSQL, applies each module's migrations and runs the same contract tests against both adapters.

## Where to see it

- [`apps/api/src/config/persistence-guard.ts`](../../apps/api/src/config/persistence-guard.ts): the guard and its refusal.
- [`packages/types/src/persistence.ts`](../../packages/types/src/persistence.ts): the shared `PersistenceMode` type.
- [`apps/api/src/quoting/quoting.factory.ts`](../../apps/api/src/quoting/quoting.factory.ts) and [`apps/api/src/orders/orders.factory.ts`](../../apps/api/src/orders/orders.factory.ts): factories choosing an adapter from the mode.
- [`modules/quoting/src/adapters/`](../../modules/quoting/src/adapters/): the in-memory and PostgreSQL adapters side by side.
