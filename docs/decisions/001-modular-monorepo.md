# 001. One repository of modules with enforced boundaries

Status: Accepted. Decided by Warren Vogel, project owner.

## Context

The ERP was meant to grow to many business capabilities: customers, quoting, orders, production, inventory and billing. The plan was to build the complete order lifecycle for one business line first, prove it, and then adapt it for the company's other business lines. That needs shared code and shared types across capabilities, and cross-cutting changes that are easy to make. It also needs clear boundaries, so that capabilities stay decoupled and a proven module can be lifted into a new context. The team was small, two to five people.

## Decision

Use a modular monorepo managed with pnpm workspaces and Turborepo:

- `apps/` holds the deployable web application and API.
- `modules/` holds one bounded context per business capability.
- `packages/` holds shared libraries, including the shared contracts in `packages/types`.

Each module exposes its contracts through `packages/types` and never imports another module's internals. Modules keep their own persistence and do not query each other's tables. Apps wire modules together and stay thin.

## Alternatives considered

- **A repository per module or business line.** Strong isolation, but versioning shared code and making cross-repository changes would be painful and heavy for a team of this size.
- **A single undifferentiated application.** Fastest to start. It would become a big ball of mud and make lifting a module into another business line impossible.

## Consequences

- Shared types remove contract drift between the web app, the API and the modules. There is one install, build and test graph.
- Respecting boundaries inside one repository takes discipline. The original record relied on convention and module structure at first. The boundary was later made mechanical: a lint rule allows a module to import only shared packages, and refuses imports of any module's `src/` internals. A module that needs something from another module declares a port, and the API composition root supplies it.
- A module can still be extracted into its own service if a real need appears. That would need a new decision.

## Where to see it

- [`modules/`](../../modules/): the bounded contexts. The quote-to-order journey uses `identity`, `crm`, `quoting`, `orders`, `documents` and `notifications`.
- [`packages/types/src/`](../../packages/types/src/): the shared contracts.
- [`packages/config/eslint/boundaries.mjs`](../../packages/config/eslint/boundaries.mjs): the lint rule that enforces the boundary.
- [`modules/quoting/src/ports.ts`](../../modules/quoting/src/ports.ts): the ports quoting declares for what it needs from other modules.
- [`apps/api/src/quoting/quoting.factory.ts`](../../apps/api/src/quoting/quoting.factory.ts): where the API wires those ports to real implementations.
