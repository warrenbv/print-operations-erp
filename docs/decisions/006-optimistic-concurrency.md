# 006. A decision is tied to the figures the person saw

Status: Accepted. Decided by Warren Vogel, project owner.

## Context

Two defects surfaced from the same missing mechanism.

- A Billing approver could approve a hand-set price they had never read. Approval took no precondition. Editing the quote's lines revoked the approval but left the quote's status alone, so a re-priced quote stayed in the approval queue carrying new figures. The approval trail is the control on hand-set prices, and its whole value is that a named person vouched for a specific price.
- Two edits to the same paper grade silently overwrote each other. The last write won with no warning.

Neither is a race in the narrow sense. Both are stale-read writes: someone reads a record, thinks about it, and writes back a decision that was right for what they saw and wrong for what is there now.

## Decision

1. Aggregates that accept a decision from a person carry a `lockVersion` integer. It starts at 1 and every write to the aggregate increments it, including writes to child rows that change what a reader would see. A quote's lines count as part of the quote.
2. `lockVersion` has no business meaning. It is never shown to a user and nothing branches on its value, only on whether it matches.
3. State-changing routes require the caller's `lockVersion` and refuse a mismatch with HTTP 409 and a distinct stale-aggregate error. The reply tells the person to re-read and resubmit, because they must now look at different numbers.
4. An edit that revokes a price approval returns the quote to draft. A re-priced quote does not belong in the approval queue.
5. The same mechanism serves grades and later aggregates. One convention, not two.

## Alternatives considered

- **Use the quote's existing version number.** It looked cheapest. It does not detect the defect: that number counts revisions in the quote's supersede chain and does not change when lines are edited, so a stale value still matches.
- **Use the updated-at timestamp.** Mechanically sound but for a precision trap. The database stores microseconds and the API serialises milliseconds, so an equality check against a round-tripped value never matches.
- **Return the quote to draft on revoke, alone.** Correct and adopted as decision 4, but it only narrows the window and does nothing for grades.
- **Approve a version rather than a quote.** The most faithful model, but the largest change, and it layers a second versioning concept onto a word already taken.
- **Database row locks.** Wrong shape. The gap is minutes of human thinking time, not milliseconds of transaction overlap. The line save and the revision do hold a row lock, for a different purpose: each makes one write atomic for the length of one transaction, and `lockVersion` remains the check against a stale read.

## Consequences

- A recorded approval is tied to the figures the approver read.
- A stale decision fails loudly instead of silently overwriting.
- Every state-changing route grows a required field that each caller must hold and return.
- Child-row writes must remember to bump the parent. A new writer that forgets reopens the hole silently, so the adapter contract tests enforce it rather than review.
- The screen has to tell people the record changed while they were reading it.

## Where to see it

- [`modules/quoting/src/services/quote-service.ts`](../../modules/quoting/src/services/quote-service.ts): the `lockVersion` checks.
- [`modules/quoting/src/ports.ts`](../../modules/quoting/src/ports.ts): `replaceLines`, which revokes a live approval and returns the quote to draft in the write that saves the lines.
- [`modules/quoting/test/contracts/`](../../modules/quoting/test/contracts/): contract tests run against both repository adapters.
- [`apps/web/src/app/approvals/`](../../apps/web/src/app/approvals/): the price-approval screen, which submits the version the approver was shown.
