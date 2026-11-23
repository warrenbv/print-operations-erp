# 002. What crosses a module boundary

Status: Accepted. Decided by Warren Vogel, project owner.

## Context

Each module owns its own schema, so every cross-module interaction goes through a port wired at the composition root (record 001). That left open which parts of the data cross. A port that hands over everything gives the same coupling a database join would, one layer up.

The question arrived when an order had to own its line items, copied from the accepted quote at conversion. A quote line carries the goods and the committed price. It also carries how the price was reached: the cost build-up, the pricing-tier snapshot and the margin-floor verdict. Nothing written down said which of these an order should keep, so the answer was argued out in review.

## Decision

When one module copies data from another, it copies the facts it owns and references how they were derived, by id.

- The order copies the goods (grade, width, quantity and related details) and the committed money (price, extended price, cost and margin), with freight held apart.
- The cost build-up, the tier snapshot and the floor verdict stay in quoting, reachable through the quote line's id.

The order is the authority for what was ordered and what it will be billed at. Quoting remains the authority for how the price was reached.

The failure this prevents is concrete. With the tier copied across, a later consumer could recompute margin from the tier and the cost instead of reading the stored margin. That is two sources for one figure, and they would eventually disagree by a rounding step on a document a customer holds the business to.

Two supporting habits:

- A consumer that stores or derives from the data declares its own shape, and the provider fills it in at the composition root. Orders asks for a new-order-line shape, not the quote aggregate.
- A module that only renders another module's data, such as the documents module, may take the provider's type. A renderer derives no business outcome.

## Alternatives considered

- **Hand over the provider's aggregate.** No mapping code. Rejected because it carries the derivation across.
- **One shared line type for quote and order.** They resemble each other today. Rejected because an order line will grow facts that mean nothing on a quote, such as fulfilled quantities and actual weights.
- **A ban on importing another module's types.** Rejected because the documents module legitimately renders quotes.

## Consequences

- The next seam has an answer before it is built. In the original system, billing read the order's stored totals and did not recompute anything from quoting. Billing is not in this edition.
- Seams that store copied data need a mapping function written out field by field. A spread operator cannot apply the test.
- This is review guidance. The record says plainly that CI does not enforce it.

## Where to see it

- [`modules/orders/src/ports.ts`](../../modules/orders/src/ports.ts): the `QuoteLookup` port and the `NewOrderLine` shape orders asks for.
- [`apps/api/src/orders/orders.factory.ts`](../../apps/api/src/orders/orders.factory.ts): the field-by-field mapping from quote line to order line, keeping the quote line's id.

The order line in this snapshot also carries some cost figures that the original record's example left in quoting. What the mapping does show is the order storing the committed price, cost and margin from the quote line, with the quote line's id kept as the route back to how they were derived.
