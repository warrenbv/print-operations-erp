# Decision traces

Four decisions from the decision register and stakeholder questions that shaped this journey. The originals record who made each call. Their "project owner" is Warren Vogel.

## 1. Production enters the lead time, in calendar days

**Question.** Where a quote's lead time comes from, and in what unit.

**Options.** An early interview round planned an estimate computed from the schedule and inventory. The requirements workshop asked whether a quote-time estimate was needed in the first release, and what would drive it.

**Decided.** At the workshop the stakeholders deferred computed estimation and had the Production Manager enter the lead time on each quote, because no production schedule existed to compute from. Production confirms the real lead time after the PO. Warren later ruled that lead times count calendar days, because the shop prints on weekends. A business-day count would describe a working week the shop does not keep, so the system needs no working calendar.

**What it changed.** A quote cannot be sent without a lead time from Production. The order's committed lead time is pre-filled from the quoted one.

## 2. The margin floor is absolute, and a hand-set price is a separate control

**Question.** Whether an approval can release a quote priced below the margin floor.

**Options.** The business requirement, the domain model and the charter's success measure said absolute. Two backlog stories said an approval released it, and one had shipped that reading.

**Decided.** Absolute. Warren ruled that nobody issues a below-floor quote and no approval releases one. The remedies are to re-price the line or for the Billing Manager to change the floor. He confirmed that a hand-set price was wanted, which did not yet exist, and made its approval a separate control for prices at or above the floor. The shipped story was corrected. He later amended the rule so that an Admin alone may override the floor on one quote with a recorded reason.

**What it changed.** Two gates on the send, each with its own owner. The register recorded the lesson that a backlog's acceptance wording is a summary, not the source.

## 3. A credit hold blocks quote creation, not sending

**Question.** Whether a credit hold should block or warn, at the quote or at order confirmation, and who sets it.

**Decided.** The stakeholder answer was to block quote generation by default, with a request to the Billing Manager to approve one anyway. Warren then settled four open points. The block falls at creation, deliberately stricter than the margin floor, accepting that Sales will make routine exception requests. The flag is stored per customer. The Billing Manager or an Admin sets it on the word of the person who manages receivables, so one role owns credit posture in the system. An approval permits exactly one quote and does not lift the hold.

**What it changed.** An exception queue on Approvals, and a hold notice that says what it stops and what it does not.

## 4. Whoever receives the PO may create the order

**Question.** Who may convert an accepted quote into an order.

**Options.** Conversion was first limited to Sales and Admin, on the reading that taking a PO is a sales act.

**Decided.** Any signed-in user. Warren had already ruled that whoever opens the mail records the PO. Once PO intake began with conversion, a role gate would have refused that person at the first step. The recorded reasoning is that conversion commits the company to nothing. The customer commits with the PO, and the company commits at confirmation, which is the Production Manager's act. A later UX review listed the open page as a possible gap. The ruling stands in this edition.

**What it changed.** Order creation has no role gate. The quote page offers the act to Sales, and the order records who converted it, taken from the session.
