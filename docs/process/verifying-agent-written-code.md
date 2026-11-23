# Verifying agent-written code

Coding agents wrote most of the Print Operations ERP, so machines did most of the checking. Warren Vogel chose which constraints the build enforced. These are the layers in the order a change meets them. The bar a change had to clear is the [definition of done](definition-of-done.md).

## The layers

**1. Types and lint boundaries.** TypeScript end to end, a lint rule that lets an app depend on modules and packages but never a module on another module, and a ban on importing any module's internals. It catches an agent reaching across a boundary because that was the shortest path. Rules are declared by folder type, so a new module is covered the day it appears. No specific catch is recorded for this layer.

**2. Unit tests.** Domain rules such as pricing and state changes, on in-memory adapters. They catch wrong logic and miss everything a real database does.

**3. Contract tests shared by both adapters.** A port's promises are written once and run against the in-memory and the database adapter. This catches two implementations that disagree. Four such defects in one day, three on the main branch, are why it exists. See [Working with coding agents](working-with-coding-agents.md).

**4. API-level tests.** Routes against their contracts, also on in-memory stores. Their recorded blind spot: a malformed id reached the database and came back as a 500, unseen by the API suites because in memory an id is just a string. A census check now covers it.

**5. Browser journeys.** A role completes a real act on screen. They catch the screen that does not work. They also ran on the main branch after each merge, the only check that saw the merged result. Before that, two branches that were each green broke a journey together. The failure appeared on 15 other merge requests and on no main-branch pipeline.

**6. Structural census checks.** Tests that parse the source and fail when a convention is broken: every write route has a screen that calls it, every id parameter is validated, every in-memory id is shaped like a real one, every role can read every read route, every send confirms its recipient, every append form carries a submission token, every file upload page answers an oversized post, every page has a title. They catch the mistake nobody writes a test for. The screen census came out of 27 acts that existed only as API routes, described in [the UI completeness audit](ui-completeness-audit.md). Exceptions sit on an allowlist, each with a reason. The list can only shrink. An entry whose route gained a caller, or no longer exists, fails the test.

**7. Repository checks.** Small scripts in the lint and documentation jobs. The migration check exists because the migration generator added a required column with no default four times out of four, and because renumbering after a branch collision left files and journal entries out of step. A test-config check found two packages running on default settings, which let a test time out and turned the main branch red on a documentation-only commit. A documentation check exists because the formatter turned committed conflict markers into a valid quote block and they reached the main branch. The documentation check is in [`ci-gates/`](../../ci-gates/).

**8. The merge gate.** The pipeline, the change-control job and a human merge. Agents rebased and re-ran the suites first, because two green branches had broken the main branch's type check.

## What none of them catch

The census proves a caller exists, not that a person can use it, and not that the values on the screen are right. Structural checks prove conventions, not that a business rule is correct. No layer can tell whether the system ever promised what a tester expected, or whether a requirement is the right one. Those stayed with Warren: the business rules and acceptance criteria, whether a change is a fix or a new feature, and the merge.

## Where each layer is in this repository

- **Types and lint boundaries:** [`packages/config/eslint/boundaries.mjs`](../../packages/config/eslint/boundaries.mjs), run by `pnpm lint`, and strict TypeScript settings in [`tsconfig.base.json`](../../tsconfig.base.json), run by `pnpm typecheck`.
- **Unit tests:** beside each module, for example [`modules/quoting/test/quote-service.test.ts`](../../modules/quoting/test/quote-service.test.ts) and [`modules/quoting/test/quote-state-machine.test.ts`](../../modules/quoting/test/quote-state-machine.test.ts).
- **Contract tests:** each module's `test/contracts/` folder, for example [`modules/quoting/test/contracts/`](../../modules/quoting/test/contracts/), run against both adapters by [`modules/quoting/test/repository-contracts.test.ts`](../../modules/quoting/test/repository-contracts.test.ts). Without a database the PostgreSQL half skips. `pnpm test:db` runs it.
- **API-level tests:** the `*.e2e.test.ts` files in [`apps/api/test/`](../../apps/api/test/).
- **Browser journeys:** one here, [`tests/portfolio/quote-to-order.spec.ts`](../../tests/portfolio/quote-to-order.spec.ts), run by `pnpm test:portfolio`.
- **Structural census checks:** all eight named above. [`every-write-route-has-a-screen`](../../apps/api/test/every-write-route-has-a-screen.test.ts), [`every-id-param-is-a-uuid`](../../apps/api/test/every-id-param-is-a-uuid.test.ts), [`every-in-memory-id-is-a-uuid`](../../apps/api/test/every-in-memory-id-is-a-uuid.test.ts), [`every-role-reads-every-get`](../../apps/api/test/every-role-reads-every-get.test.ts) and [`every-send-confirms-its-recipient`](../../apps/api/test/every-send-confirms-its-recipient.test.ts) are in `apps/api/test/`. [`every-append-form-carries-a-token`](../../apps/web/src/app/every-append-form-carries-a-token.test.ts), [`every-file-box-is-answered-over-50mb`](../../apps/web/src/app/every-file-box-is-answered-over-50mb.test.ts) and [`every-page-has-a-title`](../../apps/web/src/app/every-page-has-a-title.test.ts) are in `apps/web/src/app/`. `pnpm test` runs them. A ninth was added while this edition was prepared: [`every-e2e-app-listens-on-loopback`](../../apps/api/test/every-e2e-app-listens-on-loopback.test.ts). The API-level tests had failed now and then on a developer machine. The test client started each server on the wildcard address, and another program holding the same port on loopback answered in its place. The tests now bind to loopback, and this check fails the build if a new one does not.
- **Repository checks:** the documentation checks are in [`ci-gates/`](../../ci-gates/), with their tests. The migration check and the test-config check are not in this edition.
- **The merge gate:** [`ci-gates/governance-guard.mjs`](../../ci-gates/governance-guard.mjs) and its tests. It ran in the original pipeline and does not run here. The hosted workflow, [`.github/workflows/checks.yml`](../../.github/workflows/checks.yml), runs install, build, type checks, lint, formatting, `pnpm test`, `pnpm test:db` and the browser journey.
