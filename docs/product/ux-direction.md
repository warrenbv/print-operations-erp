# UX direction

## Why there was a UX review

During testing, staff told Warren the application was confusing. They did not know what to do next or where to click. His brief for the review was one sentence: make the UX user friendly, clear and navigable.

He set the constraints. The redesign was front-end only, so the rules, data and API stayed as they were. Pages stayed server-rendered with no extra client-side script. Every business rule stayed and had to become visible. Help text could not be the whole answer.

## How it was reviewed

Every page was captured for every role on a seeded local copy, so all reviewers judged the same evidence. Three AI reviewer agents each took a lens: task flow and wayfinding, process visibility, and forms and page patterns. A synthesis combined the reviews.

## What the reviews agreed on

The four reviews reached the same diagnosis independently:

- Nothing told a person what was waiting for them. Every role landed on the same page of links. Production had no way to find draft quotes that needed a lead time.
- Each record page already computed the right "Next" line, which the reviews called the best thing in the app. It was small grey text above a very long page.
- The obvious primary button was often the one that would be refused. On a draft quote, Send was primary before a lead time existed.
- Every page showed everything. A quote line opened every field, though a normal line needs about six.

## The three paths

| | Path 1: Guided desk | Path 2: Same map, clearer pages | Path 3: Quick clarity |
| --- | --- | --- | --- |
| Relative cost | Large | Medium | Small |
| Home | "Your work": the user's queues with counts and age | Existing cards with a "Waiting for you" section above | Unchanged, with counts on queue menu items |
| Record pages | Step strip, an Act now panel, the record, folded sections, rare acts at the foot | Act now panel and strip added to existing pages | The Next line becomes the one primary button |
| Quote entry | Four short pages: customer, lines, delivery and tax, review | One page, five visible fields and named folds | Rare fields folded in place |
| Process map | A live pipeline page | A static page | A static page |

Each path was mocked up as the same ten screens, quote through payment, plus a process-map page, so users compared like with like.

The synthesis recommended Path 2 as the base, with Path 1's "Your work" home and stepped quote entry added. Warren chose Path 1 and set the on-screen vocabulary it uses.

## Principles carried into the built screens

1. **Act first, record second.** A quote or order page opens with one panel saying what happens now for this reader: the one act and its only primary button, or "Waiting on" a named desk.
2. **Every desk sees its queue.** "Your work" lists the queues for the roles the user holds, with the oldest item. Production's "Quotes needing a lead time" queue came from this.
3. **The lifecycle is on every record.** A step strip shows where the quote or order stands.
4. **Gates are shown before the click.** A blocked act shows as a checklist naming the desk that clears each item, never only as a refusal afterwards.
5. **One name per thing.** The glossary term on every screen, and records named in words rather than internal identifiers.

In this edition, these are visible on Your work, the four quote steps, the Review and send checklist, Quotes needing a lead time and the order page. The live pipeline page is not included.
