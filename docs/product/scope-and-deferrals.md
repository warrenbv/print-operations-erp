# Scope and deferrals

The project kept two registers: one for decisions still owed, and one for things deliberately postponed. Its rule was that "not for v1" gets a row with the stance shipped instead and the reason, not a mental note. This page draws on that register and the roadmap.

## The overall bet

Build one business line's full order lifecycle well, then extract the reusable platform and adapt it to the other lines. The first release served one custom-printing business line. Other business lines, full general-ledger accounting beyond receivables, a customer portal and advanced analytics were out of the first phase unless promoted deliberately.

## Deferred in the original project

| Item | What the first release did instead | Why |
| --- | --- | --- |
| Computed lead-time estimation | Production enters the lead time on each quote | No production schedule existed to compute from |
| Automated PO ingestion and inbox reading | The PO is attached by hand and inspectable on the order | Parsing arbitrary customer PDFs reliably is hard. Attach-and-view gives most of the value |
| Card payment processing | Card payments marked by hand | An external dependency not needed to prove the flow |
| Full inventory management | Record consumption and waste, with optional on-hand entry | Build the data foundation first |
| Purchasing paper from suppliers | Paper ordering stays manual. Confirmation records whether paper was ordered or pulled from stock | Tied to full inventory |
| Replacing the legacy billing system | Keep it, fed by an export from the ERP | Ledger replacement is high-risk. An export buys time |
| The export file itself | Capture every billing dimension from day one. Entry into the legacy billing system stays a manual step | Warren judged that nothing in the first release consumed the file |
| Customer statements and finance charges | Stay in the legacy billing system | They span every business line on one account |
| Customer portal | Staff and automated emails | Internal workflow value first |
| Advanced analytics | Three core operational reports | Get operational reporting right first |
| Press-schedule calendar | Capture schedule data and show jobs by stage | A calendar needs data across more products |
| Label converting | Stays on the manual process | No pricing model existed for it in the first release |
| Online and field quoting by customers or reps | Not built | Raised by the business during pricing sign-off as a future channel |
| The proof approval loop | Runs outside the platform. The ERP records the outcome | An accepted limitation: the press gate trusts a checkbox. Revisit when a misprint traced to a stale checkbox makes the gap concrete |

## A deferral that was reversed

Sending each document to more than one contact, chosen by role, was first deferred in favour of one confirmed recipient per customer. The register set the condition for revisiting it: the single-contact flow chafing in use. After the testers' kickoff Warren reversed the deferral, and contacts now carry document roles. The register kept the entry, marked as built, so the reversal stays on the record.

## The tax model in this edition

Demo Printworks is fictional, and its tax model is the original's by design: a plant in Idaho that sells into Idaho and Washington, with Washington's destination-based rates loaded from the state's public rate files. The rate files in the test fixtures are the state's public releases, and the Idaho rate is the one in statute. Location codes in the 9000s, and the rates beside them, are invented for the tests and the demo. Any other Washington code that appears, such as the example in the help text, is a real public one. The business, its customers, its addresses and its prices are invented.

## Not in this public edition

These were built in the original system and are left out of this edition. They are not deferred.

- Job tickets, the production floor, consumption and waste recording
- Shipments, packing slips, pallet tags and freight charged after weighing
- Invoicing, receivables, payments, receipts and month close
- Reporting
- Inventory on hand
- The live pipeline page

The quote and order pages show a three-step strip: Quote, Order and Confirmed. A confirmed order says that production, shipping and invoicing are outside this edition.
