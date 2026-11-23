# Web application

## What it is responsible for

The browser-facing Next.js application. It draws every screen of the quote-to-order journey on the server and sends every change to the API through a server action. It stores no business data and computes no prices. The API and its modules decide, and this application shows the outcome and the conditions before the click ([decision record 004](../../docs/decisions/004-server-first-web-ui.md), [UX direction](../../docs/product/ux-direction.md)).

## Public surface

Nothing imports from this application. Its surface is its routes: `/login`, `/` (Your work), `/crm/customers`, `/quoting/quotes` and the pricing settings under `/quoting`, `/approvals`, `/production/lead-times`, `/orders`, `/admin/users`, `/admin/roles` and `/demo`.

- It depends on `@erp/types`, `@erp/ui` and `@erp/utils` and imports no module. Request and response shapes come from `@erp/types` and are parsed on the way in.
- Every call its server makes to the API with the person's session goes through [`src/lib/api-fetch.ts`](src/lib/api-fetch.ts), directly or by way of [`src/lib/fetch-parsed.ts`](src/lib/fetch-parsed.ts), which forwards the session cookie and no other cookie ([decision record 005](../../docs/decisions/005-server-side-sessions.md)). Its two other calls send no cookie at all: sign-in in [`src/app/login/actions.ts`](src/app/login/actions.ts) and the API health line in [`src/lib/api-health.tsx`](src/lib/api-health.tsx).
- Pages are server components. The one client component is [`src/app/error.tsx`](src/app/error.tsx), which the framework requires. Links are plain anchors, so every navigation is a full page load.
- `src/app/quoting/` holds the quote screens: the queue, the four quote steps, review and send, conversion to an order, and the pricing settings. `src/lib/` holds the shared helpers: API access, the session read, the work queues (`src/lib/work/`), and the step strip and Act now panel (`src/lib/record/`).

Demonstration mode is on when `PORTFOLIO_DEMO` is `true` and the API address is plain HTTP on the local machine ([`src/lib/portfolio-demo.ts`](src/lib/portfolio-demo.ts)). The sign-in page then shows one button per demonstration account, Sales, Production Manager, Billing Manager and Administrator, and no username and password form. A button signs in through [`src/app/login/demo-actions.ts`](src/app/login/demo-actions.ts) with the password from `PORTFOLIO_DEMO_PASSWORD`. The launcher, [`scripts/demo-config.mjs`](../../scripts/demo-config.mjs), sets both settings and gives the API the same accounts and password.

## State it owns

No stored data. It holds:

- the session cookie `erp_session`, which carries the API's opaque session token, and a theme cookie
- an in-memory map of submission tokens ([`src/lib/submission-token.ts`](src/lib/submission-token.ts)), so a repeated post of an append form gets the first outcome instead of a second record

The quote and order state machines belong to `modules/quoting` and `modules/orders`. This application reads each record's status and work line to draw where it stands.

## Rules it enforces

The API enforces every rule. This application makes each one visible before the click and posts the version the person saw.

- A credit hold blocks a new quote, with a single-use exception: [R2](../../docs/product/requirements.md). `src/app/crm/customers/[id]/` and `src/app/approvals/`.
- Production enters the lead time, and its queue: [R5](../../docs/product/requirements.md). `src/app/production/lead-times/`.
- The floor and hand-set price decisions, each with its owner: [R6 and R7](../../docs/product/requirements.md). `src/app/approvals/components/price-override-review.tsx`.
- The order keeps the customer's PO: [R9](../../docs/product/requirements.md). The Production Manager confirms in calendar days, pre-filled from the quote: [R11](../../docs/product/requirements.md). `src/app/orders/[id]/`.
- Every quote and order page and Your work say whose move it is: [R12](../../docs/product/requirements.md). [`src/app/page.tsx`](src/app/page.tsx) and `src/lib/record/lifecycle.ts`.
- A decision or edit posts the record's `lockVersion`, and a stale one is refused: [decision record 006](../../docs/decisions/006-optimistic-concurrency.md).

## Where to start reading

One screen end to end, the Production Manager confirming an order:

1. `src/app/orders/[id]/page.tsx` reads the order and builds its step strip and Act now panel.
2. `src/app/orders/[id]/components/order-act-now.tsx` shows `ConfirmForm` from `components/lifecycle-actions.tsx` to a reader who may confirm. The form posts the days and the order's `lockVersion`.
3. `src/app/orders/[id]/lifecycle-actions.ts` holds `confirmOrderAction`. It reads the form with `confirm-request.ts` and calls `POST /orders/:id/confirm` through [`src/lib/api-fetch.ts`](src/lib/api-fetch.ts).
4. [`apps/api/src/orders/orders.controller.ts`](../api/src/orders/orders.controller.ts) checks the role and the version, and the page redraws with the job number.

Then [`src/app/layout.tsx`](src/app/layout.tsx) and [`src/middleware.ts`](src/middleware.ts) for the shell around every page, and [`src/app/login/`](src/app/login/) for sign-in.

## Tests

- Unit tests sit beside the code as `*.test.ts`. They cover the pure helpers that read forms and word what a page shows, with no browser and no API.
- Structural tests read the source and fail the build when a convention breaks: [`every-append-form-carries-a-token.test.ts`](src/app/every-append-form-carries-a-token.test.ts), [`every-file-box-is-answered-over-50mb.test.ts`](src/app/every-file-box-is-answered-over-50mb.test.ts) and [`every-page-has-a-title.test.ts`](src/app/every-page-has-a-title.test.ts). [Verifying agent-written code](../../docs/process/verifying-agent-written-code.md) describes the layer.
- The screen census, [`apps/api/test/every-write-route-has-a-screen.test.ts`](../api/test/every-write-route-has-a-screen.test.ts), parses this application's API calls and fails when a write route has no screen.
- The browser journey through quote to order is [`tests/portfolio/quote-to-order.spec.ts`](../../tests/portfolio/quote-to-order.spec.ts), run by `pnpm test:portfolio`.

`pnpm test` runs every package with no database, and `pnpm test:db` runs the same suite against a throwaway local Postgres. This application's tests do not touch a database.
