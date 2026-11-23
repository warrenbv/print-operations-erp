# 004. A server-first web interface

Status: Accepted. Decided by Warren Vogel, project owner. Proposed by the coding agent building the first quote entry screen.

## Context

The sales quote entry form was the first real front-end feature. The few existing pages were React Server Components with native forms, with no styling framework, form library or client data layer. Whatever the quote form picked would become the pattern every later screen copied, so it was a structural decision.

The forces:

- The application ran on-premises over the office network, so a server round-trip took milliseconds. Re-rendering on the server was a workable interaction model.
- Pricing had to stay on the server anyway. The pricing engine, the margin floor and the rule that a stored verdict is the verdict all forbid client-side price arithmetic.
- The shared Zod layer already gave validation without a form library, if forms submit to server actions.
- A client stack with form state, a query cache and optimistic updates is a second architecture to maintain and a second place for validation to drift.

## Decision

1. Pages are React Server Components. Interactivity is native HTML forms: GET forms for filters, server actions for changes, and submit-button intents for structural edits such as adding a line.
2. Validation is the shared Zod schemas, parsed on the server in the action and again at the API edge. Constrained inputs prevent most invalid submissions. Remaining errors come back as server-rendered messages.
3. Styling is inline style objects over a shared set of token values. A style or component moves into `packages/ui` when it reaches its third consumer.
4. There is no client data layer. Server components fetch from the API with caching off, and changes revalidate the page.

The original allowed a client-side island as a justified exception. Later that month Warren narrowed that to no exception beyond what the framework forces. The case behind the ruling was the top navigation bar, which kept highlighting the previous page after a client-side navigation. A small client component would have fixed it and was refused. Instead every internal link became a plain anchor, so every navigation is a full page load and the server renders the bar correctly. A lint rule now refuses the framework's client-side link component so the rule does not depend on memory.

## Alternatives considered

- **A client form stack.** Rich interactivity and instant validation, but validation duplicated on the client, client state as a second architecture, and responsiveness the network did not need.
- **Server-first plus a utility CSS framework.** Faster styling, but a design language before any design system existed, more build tooling, and restyling of existing pages.

## Consequences

- One way to render, one way to validate, one place prices are computed. A new screen copies a pattern instead of making a choice.
- Every interaction is a round-trip. There is no live pricing preview, and the form prices on save. A rejected submission can lose unsaved field values, which constrained inputs make rare.

## Where to see it

- [`apps/web/src/app/quoting/quotes/`](../../apps/web/src/app/quoting/quotes/): the quote screens and their server actions.
- [`apps/web/src/app/error.tsx`](../../apps/web/src/app/error.tsx): the only client component, which the framework requires.
- [`packages/config/eslint/boundaries.mjs`](../../packages/config/eslint/boundaries.mjs): the rule refusing the client-side link component.
- [`packages/types/src/quote.ts`](../../packages/types/src/quote.ts): shared schemas used by both the web app and the API.
