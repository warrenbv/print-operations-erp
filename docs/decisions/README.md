# Decision records

These are architecture decision records from the Print Operations ERP. Each one states the problem, the decision, the options that were rejected and why, and what the decision cost. Each ends with the places in this repository's code where you can see the decision.

They are adapted from the original project's decision log, which held more than forty records. The eleven here were chosen because they govern the quote-to-order journey this edition contains, and because they show how product and architecture choices were made.

## How decisions were made

Warren Vogel, as project owner and technical lead, was the decider on every record. Coding agents drafted the records under his direction. The project's rules said an agent could propose a record but never accept one. The originals say this plainly in places. One was proposed by the agent building the first quote screen and accepted on his direction. Others record that the decision was his, made in a working session, and that only the typing was delegated.

## What was changed for this edition

- Customers, suppliers, colleagues and the legacy vendor system are not named. The business inside the examples is the fictional Demo Printworks.
- Infrastructure specifics are removed: hosts, the code-hosting platform's setup, mail routing and deployment.
- Real prices, margins, rates and accounting codes are removed.
- Internal tracker references are removed: issue numbers, requirement and open-decision IDs, and the original record numbers. The records are numbered afresh.
- Where a record dealt with an area this edition does not include, such as invoicing or the production floor, that part is left out or marked as not in this edition.

The reasoning, the rejected options and the consequences are kept as the originals state them.

## Index

| No. | Decision |
| --- | --- |
| [001](001-modular-monorepo.md) | One repository of modules with enforced boundaries |
| [002](002-what-crosses-a-module-boundary.md) | What crosses a module boundary |
| [003](003-decimal-arithmetic.md) | Decimal arithmetic for money and rates |
| [004](004-server-first-web-ui.md) | A server-first web interface |
| [005](005-server-side-sessions.md) | Server-side sessions, not tokens |
| [006](006-optimistic-concurrency.md) | A decision is tied to the figures the person saw |
| [007](007-persistence-switch-at-the-composition-root.md) | The storage choice lives at the composition root |
| [008](008-operating-model-for-coding-agents.md) | How developers and coding agents work in one repository |
| [009](009-technology-stack.md) | The technology stack and how it was chosen |
| [010](010-orm-spike.md) | Drizzle, UUIDv7 keys and money as `numeric`, from a spike |
| [011](011-agent-triage-of-defect-reports.md) | Agent triage of defect reports, phase by phase |

The working practice behind these records is in [docs/process](../process/).

## Other decisions in the original log

The original log held 42 records. Sixteen of them are adapted above, some combined into one record. These are the rest that can be stated without private detail. They are not published in full.

- **Recording decisions.** Significant decisions are kept as numbered, dated records in the repository, beside the code they govern.
- **Document rendering.** A template turns domain data into a small declarative document model, and the PDF engine is one adapter behind a port.
- **Received documents.** A document a customer sends is stored and handed back as opaque bytes, and never parsed or previewed on the server.
- **Effect seams.** A module declares the effect it needs in its own words, and the composition root supplies it from whichever provider does the work.
- **One send log.** Every message the system sends is recorded in one log owned by the notifications module, keyed to its record by type and id rather than a foreign key.
- **Production manager authority.** The production manager role grants authority, not only notifications, and cancelling an order needs that role, billing or an administrator.
- **Shipments.** A shipment is a second aggregate inside the orders module, not a module of its own.
- **The credit-hold approval.** Permission to quote a customer on credit hold belongs to quoting and is spent in the same transaction that creates the quote.
- **Billing freight.** Freight is billed from the shipments, and the order line keeps its estimate as the record of what was quoted.
- **Tax rates.** Tax rates are imported rows selected by effective date, not a live lookup.
- **Workbook loads.** Spreadsheet imports run in two stages, extract then reconcile, are safe to repeat and report before they write.
- **Pending work across modules.** "What is waiting on a decision" is composed at the composition root into one union contract, not kept in a shared store.
- **Themes.** Colours are CSS custom properties defined once, and the design tokens resolve to them. Proposed, not accepted.
- **Order amendments.** An order can be amended until it is invoiced, within limits set by what has shipped, and every amendment is recorded with who, when and the values before and after.
- **One delivery date per order.** Each delivery date on a customer's purchase order becomes its own order, converted from the quote that holds the price.
- **Tax code lookup.** A lookup from a delivery address fills in the tax jurisdiction and is never a source of rates.
- **Month close.** Money is counted in accounting months that billing closes, and a closed month takes no new payment or credit.
- **Dating payments and credits.** A payment or credit may be dated any day up to the end of the current accounting month, never in a later one.

Eight records are left out of this list because their subject or title alone would reveal infrastructure or business specifics, such as deployment, mail routing, production access and the legacy billing system.
