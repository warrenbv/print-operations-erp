# The UI completeness audit

In late August 2026 the Print Operations ERP had green tests, a green pipeline, and workflows nobody could perform. This page covers how that was found and what changed.

## What prompted it

Before the parallel run, role-by-role training tours were written so each kind of user could be walked through the screens they would use. Writing them exposed seven acts that had a working API route and passing tests but no screen. Entering a quote's lead time, and producing and sending the quote, were among them. The tour drafts had to fall back on the owner performing those steps while the tester checked the result.

Some gaps were less visible. The production tours never mentioned several documents and steps the floor depends on, because there was no screen to describe. The production register called that absence the tell.

Warren raised a full audit so that every screen a role needs would exist before the parallel run.

## How it worked

The audit was read-only and split into three registers: sales, production and finance. Each register asked one question of every story, route and document: whether the person in that role could do it in a browser without an engineer. A route that works but that no page calls counted as no. Every verdict cites a file path so a reader can check it.

The verdicts were: built in the UI, API-only, partial (a screen exists but cannot complete the act), missing, system-only by design, and already in progress.

## What it found

Across the three registers the audit judged 87 must-have and should-have stories. Forty were complete in the browser. The rest were system-only by design, partial, API-only or already being fixed. Of 51 write routes, 15 had no page calling them.

Beyond the seven acts already known, the registers raised 20 more gaps: six in sales, five in production and nine in finance. That made 27 acts that existed only as API routes or could not be completed on a screen.

The sales register is the one that covers this edition. It found, among other gaps:

- A customer could be refused for a credit hold, but no screen could set or lift the hold.
- Pricing tiers could not be changed without an engineer and a schema migration.
- The tax delivery address on a quote line was stored and carried to the order, but no screen captured it.
- A quote could be sent, but nothing showed whether it went, when, or to whom.

## What changed

- **The missing screens were built.** The sales register records every one of its gaps closed by 1 September 2026.
- **A route-to-screen census was added to the build.** It fails when an API write route has no page that calls it, unless the route is on an allowlist with a checked reason. Its allowlists are now empty.
- **The definition of done changed.** A story with a human actor is done only when that actor can perform it in the browser and a browser journey proves it. See the [definition of done](definition-of-done.md).

## Where the check lives

- [`apps/api/test/every-write-route-has-a-screen.test.ts`](../../apps/api/test/every-write-route-has-a-screen.test.ts): the route-to-screen census. Its two allowlists are empty in this repository.
- [`tests/portfolio/quote-to-order.spec.ts`](../../tests/portfolio/quote-to-order.spec.ts): the browser journey through this edition's quote-to-order workflow.

The training tours and the production and finance areas the audit covered are not in this edition.
