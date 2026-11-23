# Definition of done

Adapted from the Print Operations ERP's engineering standards. Every merge request was measured against this checklist, whether a developer or a coding agent wrote it. Warren Vogel owned the acceptance decisions made against it.

Work is done when it is shippable and maintainable, not when the code runs on one machine.

## The checklist

A change is done when:

- **It meets the acceptance criteria** written on the story.
- **It respects module boundaries.** No imports of another module's internals, no SQL across another module's schema, and cross-module data passes through contracts in `packages/types`.
- **It is tested** at the right level: unit, integration or browser, with critical paths covered.
- **Adapters agree.** If the change touches a port with more than one adapter, the promise is asserted in that port's contract suite, which runs against every adapter, not in one adapter's own test file.
- **CI is green.** Lint, type checks, tests and build pass.
- **Docs are updated in the same change.** Behaviour or convention changes update the relevant page, architectural changes have a decision record, and the module's README still matches the code.
- **Schema changes include migrations** that run cleanly.
- **No secrets are committed**, access is least-privilege, and there is no obvious security or data-integrity problem.
- **It is reviewed and approved**, and governance-protected paths are untouched or approved by the owner.
- **Names match the glossary.**
- **It is usable in the browser.** A story with a human actor is done only when that actor can perform the act in the browser, and a browser journey proves it. An API-only delivery is partial. The story stays open with the missing screen named on it.
- **It was exercised end to end** wherever there is a running surface, not assumed to work.

If any box is unchecked, the work is not done. The standard says to state that plainly rather than merge around it.

## Why the browser box exists

Green tests used to be enough. Then preparing role-by-role training tours, and the audit that followed, found 27 user acts that existed only as API routes. Every one passed its tests. Nothing in the build required a screen, so nothing produced one. The [UI completeness audit](ui-completeness-audit.md) describes what was found and closed.

Two checks now hold the line, so it does not depend on a reviewer noticing.

- **The screen census.** A test parses every API controller and every call site in the web app. A write route with no page that calls it fails the build unless it is on an allowlist. An allowlist entry must give a checked reason: the route is system-only, it is run from the command line, or its screen is open work with an issue. Read routes have the same ratchet. The lists can only shrink, and both are now empty.
- **Browser journeys** prove that a role can actually complete the act. The census proves a caller exists. It cannot prove a person can reach it, because a server action that no form posts to would satisfy it. The journey covers that half. The census is cheap and runs on every commit. The journey is slower and catches the screen that does not work.

In the original project, the role training tours were also the acceptance artifact for each role. A scenario that had to tell the reader to ask the owner marked a story that was not done.

## In this edition

These checks are in this repository and run with its commands. The demo runs in memory and applies no migrations. `pnpm test:db` applies each module's migrations to a throwaway local PostgreSQL and runs the contract suites against the database adapters. The training tours and the story tracker are not published.

- [`apps/api/test/every-write-route-has-a-screen.test.ts`](../../apps/api/test/every-write-route-has-a-screen.test.ts): the screen census, with both allowlists empty.
- [`tests/portfolio/quote-to-order.spec.ts`](../../tests/portfolio/quote-to-order.spec.ts): the browser journey, run by `pnpm test:portfolio`.
- [`modules/quoting/test/contracts/`](../../modules/quoting/test/contracts/) and [`modules/quoting/test/repository-contracts.test.ts`](../../modules/quoting/test/repository-contracts.test.ts): one module's adapter contract suites and the file that runs them against both adapters. The other modules follow the same pattern.
- [`packages/config/eslint/boundaries.mjs`](../../packages/config/eslint/boundaries.mjs): the module boundary, checked by `pnpm lint`.
