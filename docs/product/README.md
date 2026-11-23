# Product documents

These pages show the product work behind the quote-to-order journey in this edition: the problem, the roles, the requirements, the decisions and the scope choices. They are adapted from the project's working product documents, which were kept in the repository alongside the code: the business and product requirements, the process map, personas, the decision register, the stakeholder questions, the deferral register, the roadmap and the UX review.

| Page | What it covers |
| --- | --- |
| [Problem and process](problem-and-process.md) | The business problem and the quote-to-order process before and after |
| [Roles](roles.md) | Who acts in the journey, what each needs, and what each may and may not do |
| [Requirements](requirements.md) | Twelve requirements with acceptance criteria and where to see each in the demo |
| [Decisions](decisions.md) | Four decisions that shaped the journey, with the options and reasoning |
| [Scope and deferrals](scope-and-deferrals.md) | What the first release left out and why, and what this edition leaves out |
| [UX direction](ux-direction.md) | The UX review, the three directions mocked up, and the principles that were built |

## What was removed

Inside these documents the business is presented as the fictional Demo Printworks. Names of customers, suppliers and colleagues are removed. So are real prices, costs, margins, rates and ledger codes, hostnames, dates of individual rulings, and internal tracker references. The legacy vendor system is called the legacy billing system. Decisions are attributed by role, as the originals attribute them. Warren Vogel is named where the originals show he made the call.

Requirements and decisions outside the quote-to-order journey are left out, except in the scope page.

## What you can check against the demo

The demo is the application in this repository, started with `pnpm demo`. The [main README](../../README.md) says how to run it and walks through the journey.

Each requirement ends with "See it in the demo", naming the screen or step where the rule is visible. The demo signs in as Sales, Production Manager, Billing Manager or Administrator. The rules most worth checking:

- A quote cannot be sent until Production has entered its lead time.
- A line below the margin floor blocks the send, and only an Admin can override it.
- A hand-set price waits for the Billing Manager's approval.
- The order carries the quote's prices and the customer's PO, and then waits for the Production Manager to confirm it.

All figures in the demo are fictional and are not the original system's pricing inputs.
