# Requirements for the quote-to-order journey

Adapted from the original business and product requirements, the decision register and the stakeholder answers. They cover only this edition's journey. The numbering is new.

## R1. A quote starts from a customer

- Sales chooses the customer first. A quote cannot exist without one.
- The quote goes only to the customer's contacts tagged for quotes. If nobody is tagged, it cannot be sent.

**See it in the demo:** New quote, then the Customer step, choosing Northstar Demo Packaging. The recipient condition on Review and send.

## R2. A credit hold blocks a new quote, with a single-use exception

- A customer on credit hold cannot have a new quote or revision created. The block falls at creation, not at send.
- Sales may ask for an exception. The Billing Manager approves or refuses it.
- An approved exception permits exactly one quote, is used up when that quote is started, and does not lift the hold.
- Only the Billing Manager or an Admin sets or clears the hold.

**See it in the demo:** as Billing Manager, Place on hold in the Credit hold section of a customer page, such as Cedar Demo Outfitters. As Sales, New quote for that customer, which offers Request an exception with a reason instead of Start quote. As Billing Manager, Approvals, Exceptions. After the approval Sales can start one quote, and the next attempt meets the hold again.

## R3. Sales prices a line without waiting on anyone

- A line takes paper grade, width and quantity. Rarely needed fields sit under More options.
- The system prices the roll from the grade's cost, waste, hardware and the pricing tier, using configured values.
- The price build-up shows each line's cost, tier, margin and floor result.

**See it in the demo:** the Lines step, paper Kraft — 30# — 1,250 ft — Long roll, width 12", quantity 10. Hand-set price and the pricing tier are under More options. The Price build-up page.

## R4. Freight and tax are explicit

- Freight is priced by shipping mode and kept apart from the roll price.
- Freight that depends on a carrier bid shows TBD until the bid is entered.
- Each line carries a tax treatment and a delivery address.

**See it in the demo:** Tax treatment on the Lines step, Non-taxable. The Delivery and tax step shows each line's delivery address and lets the treatment be changed.

## R5. Production supplies the lead time before the quote can be sent

- Every quote carries a lead time in days.
- Production or the Production Manager enters it. Sales cannot.
- Until then, Send is unavailable and the page says Production enters the lead time.

**See it in the demo:** as Sales, Review and send before the lead time exists. As Production Manager, Quotes needing a lead time on Your work (also Needs a lead time under Production), then the quote's Enter the lead time panel, 10 days.

## R6. The margin floor is absolute for every role but Admin

- A quote with a line below the margin floor cannot be sent, and no approval releases it.
- The remedies are to re-price the line or for the Billing Manager to change the floor in configuration.
- An Admin may override the floor on one quote with a recorded reason. Editing the lines revokes the override.
- Freight margin does not count toward the floor, so freight markup cannot rescue a thin product price.

**See it in the demo:** as Sales, a hand-set price below the floor under More options on the Lines step, then the floor condition on Review and send. As Administrator, the same Review and send page offers Override the floor, with a required reason. As Billing Manager, Pricing constants under Settings shows the floor.

## R7. A hand-set price needs the Billing Manager's approval

- A line with a hand-set price at or above the floor cannot be sent until the Billing Manager approves it.
- The approval applies to the figures the Billing Manager read. Editing the lines afterwards revokes it and returns the quote to draft.

**See it in the demo:** Hand-set price per roll under More options on the Lines step, then the request for approval on Review and send. As Billing Manager, Approvals, Price approvals.

## R8. Sending shows every condition before the click

- Review and send lists each condition with the desk that clears it: priced lines, floor, price approval, lead time, recipients and any credit hold.
- Send is offered only when every condition is clear. Otherwise it is disabled with its reason.

**See it in the demo:** Review and send. The email is printed in the terminal running `pnpm demo`, not sent.

## R9. The order keeps the quote's terms and the customer's PO

- Converting creates an order with its own copy of the quote's lines at the quoted prices.
- A later revision of the quote does not change an existing order.
- The order records the customer's PO number and, optionally, the PO document.

**See it in the demo:** Convert to order on the sent quote, PO number PO-DEMO-1, Create 1 order, then the order page and its lines.

## R10. Whoever receives the PO may create the order

- Any signed-in user may convert an accepted quote. The quote page offers the act to Sales.
- The person who converted is recorded from the session.
- Conversion commits the company to nothing. The commitment is made at confirmation.
- A quote may be converted more than once. The quoted quantity is not a limit, and the convert page shows what earlier orders took.

**See it in the demo:** the Convert to order panel on a sent quote, as Sales. Create another order on the same quote afterwards.

## R11. The Production Manager confirms the order

- Production or the Production Manager confirms the order and commits a lead time, pre-filled from the quoted one.
- The committed lead time is a count of calendar days.
- Sales cannot confirm.

**See it in the demo:** as Production Manager, the order page's Confirm the order panel.

## R12. Every quote and order says whose move it is

- Each quote and order page opens with a panel naming the next act, or the desk it is waiting on.
- A step strip shows where the record stands. Your work lists the signed-in desk's queues.

**See it in the demo:** the order page after conversion, waiting on the Production Manager. Your work for each demo role.
