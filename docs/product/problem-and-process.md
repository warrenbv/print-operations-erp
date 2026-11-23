# Problem and process

## The business problem

Demo Printworks sells converted paper rolls. Before the ERP, its pricing ran on a separate spreadsheet model for each paper grade, each with its own customer list. The ledger and receivables ran in a separate legacy billing system.

The working documents named four problems:

- **Quoting ran through one desk.** Quotes were built by hand in Billing, and Sales passed each request there and waited.
- **The same data was keyed several times.** Invoicing and receivables re-entered orders into a monthly spreadsheet and then into the legacy billing system.
- **Nobody could see the whole order.** Knowledge sat in spreadsheets and in individual people.
- **No reporting came out of the work.** Consumption, margin and job duration were effectively invisible.

The goal was one system of record. A salesperson enters the specification once and the system carries it to whoever acts next.

## Quote to order, before

| Who | What they do | Where time or information was lost |
| --- | --- | --- |
| Customer | Asks for a price | |
| Billing Manager | Works out roll size and quantity and calculates a price per roll in that grade's spreadsheet | Every request went through one desk. Sales could not quote. |
| Not recorded | Sends the quote | Production did not know the work was coming. |
| Customer | Accepts and sends a PO | |
| Production Manager | Approves the PO after checking material and lead time by hand | The lead-time commitment came late, with no system view. |
| Production Manager | Orders paper or pulls stock, then sends an order confirmation with terms, price and lead time | The terms were copied again into each document. |

A paper quote book already enforced the margin floor. The aim was to move that enforcement, and its audit trail, into the system.

## Quote to order, in the ERP

| Who | What they do | What is handed over |
| --- | --- | --- |
| Sales | Chooses the customer and enters each line: grade, width, quantity, shipping mode, tax treatment | A draft quote |
| System | Prices each line from configured grades, tiers and freight rules and checks the margin floor | Priced lines with an inspectable build-up |
| Billing Manager | Approves a hand-set price, only if Sales set one | An approval tied to those figures |
| Production | Enters the lead time on the draft quote | A quote that can be sent |
| Sales | Sends the quote once every condition is clear | The quote, emailed to the contacts tagged for quotes |
| Whoever receives the PO | Converts the accepted quote | An order with its own copy of the quoted lines and the PO |
| Production Manager | Confirms the order and commits the lead time | A confirmed order |

This edition demonstrates these seven steps. In the original system the order continues to production, shipment, invoice and payment.

## The reported result

Discovery estimated a saving of 20 to 40 staff hours a week for the first business line. As of November 2026 Warren Vogel reports **25 staff hours saved per week** in production use, comparing staff hours before and after the original system went into use. It is not a measurement of this demo.
