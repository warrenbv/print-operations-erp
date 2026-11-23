# Config package

## What it is responsible for

`@erp/config` holds the shared build-tool presets: ESLint, Prettier and Vitest. It carries no runtime code. Among the lint rules is the one that enforces the module boundaries.

## Public surface

Three entry points, declared in [package.json](package.json):

- `@erp/config/eslint`: [eslint/index.mjs](eslint/index.mjs), applied by the root [eslint.config.mjs](../../eslint.config.mjs) to every app, module, package, script and test.
- `@erp/config/prettier`: [prettier/index.mjs](prettier/index.mjs), named in the root `package.json`.
- `@erp/config/vitest`: [vitest/index.mjs](vitest/index.mjs), which each package's `vitest.config.mjs` starts from.

Runtime code does not belong here: [docs/decisions/007-persistence-switch-at-the-composition-root.md](../../docs/decisions/007-persistence-switch-at-the-composition-root.md) records that bar.

## State it owns

None.

## Rules it enforces

The boundary rule in [eslint/boundaries.mjs](eslint/boundaries.mjs) implements [docs/decisions/001-modular-monorepo.md](../../docs/decisions/001-modular-monorepo.md):

- A module may import packages only, never another module. What it needs from another module it declares as a port, and the API composition root supplies it.
- An app may import modules and packages.
- A package may import other packages only.
- Nothing may import the `src/` internals of a module or an `@erp/*` package. Only the public entry point counts.

Rules are declared by folder type, so a new module or package is covered the day it appears. Which data crosses a boundary is review guidance and is not linted: [docs/decisions/002-what-crosses-a-module-boundary.md](../../docs/decisions/002-what-crosses-a-module-boundary.md).

The same file refuses the framework's client-side link component, so every navigation is a full page load: [docs/decisions/004-server-first-web-ui.md](../../docs/decisions/004-server-first-web-ui.md). [eslint/web-ui.mjs](eslint/web-ui.mjs) makes every action in the web app the shared `Button` or `LinkButton` from [packages/ui/src/form.tsx](../ui/src/form.tsx).

## Where to start reading

- [eslint/boundaries.mjs](eslint/boundaries.mjs): the boundary rule, the exhibit for record 001.
- [eslint/base.mjs](eslint/base.mjs): TypeScript rules and naming conventions.
- [vitest/index.mjs](vitest/index.mjs): the shared test defaults.

## Tests

This package has none of its own. Its rules are exercised by `pnpm lint` and `pnpm format:check` over the whole tree, and its Vitest preset by every package's `pnpm test` and `pnpm test:db` run. [docs/process/verifying-agent-written-code.md](../../docs/process/verifying-agent-written-code.md) places the lint boundaries as the first layer of checks.
