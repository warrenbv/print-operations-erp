# Security and access

What is true about sign-in, sessions, roles and isolation in the application as it ships in this repository. Each statement names the code that makes it true. The reasons for the session design are in [decision record 005](decisions/005-server-side-sessions.md). What each role is for is in [Roles in the journey](product/roles.md).

## Roles and what each may do

The roles are listed once, in [`packages/types/src/roles.ts`](../packages/types/src/roles.ts), with the list of roles allowed for each act. The API guards its routes with those lists, and the web pages read the same lists to decide what to offer. One gate names its role in the controller instead: granting roles, which is Admin only. A grant sets the roles and refreshes the display name and email of a user who exists, never renames an account, and refuses the break-glass account and its reserved name ([`modules/identity/src/admin-role-service.ts`](../modules/identity/src/admin-role-service.ts)). A role is re-read from the user record on every request, so a change takes effect at once.

| Role | On the sign-in page as | May, in this edition |
| --- | --- | --- |
| `Sales` | Sales | Add and edit customers and contacts, start, price, revise and send quotes, set a hand-set price and request its approval |
| `ProductionManager` | Production Manager | Enter a quote's lead time, confirm an order |
| `Production` | Not offered | The same two acts. The role exists in the code, and the demo does not offer an account that holds it |
| `Billing` | Billing Manager | Change paper grades, pricing tiers, pricing constants (the margin floor among them) and tax rates, set and lift a credit hold, approve or reject a hand-set price, approve or reject a credit-hold exception |
| `Admin` | Administrator | Every role-gated act, and three that are Admin's alone: granting roles, overriding the margin floor on one quote with a reason, and reading the Users and Roles pages |

Every role may email an order confirmation once the order is confirmed.

The table follows the role lists in the code. In the running demo these acts were performed as the role named: Sales pricing, sending and converting a quote, setting a hand-set price and requesting its approval, and asking for a credit-hold exception. The Production Manager entering a lead time and confirming an order. The Billing Manager placing a credit hold, approving the exception and approving a hand-set price. The Administrator overriding the floor with a reason and opening Users. The other acts in the table rest on the role lists and the API tests in `apps/api/test/`.

## Which routes need what

Every API route is guarded. Two guards run on every request, registered globally in [`apps/api/src/auth/auth.module.ts`](../apps/api/src/auth/auth.module.ts): [`session.guard.ts`](../apps/api/src/auth/session.guard.ts) finds the session and [`roles.guard.ts`](../apps/api/src/auth/roles.guard.ts) checks what the route declares. A route declares `@Public`, `@Authenticated` or `@RequireRoles(...)` ([`authz.decorators.ts`](../apps/api/src/auth/authz.decorators.ts)). A route that declares nothing is refused.

Before either guard, a write that carries a browser `Origin` other than the web app's (`WEB_ORIGIN`) is refused with 403 `foreign-origin`, before its body or upload is read. A write is any method but `GET`, `HEAD` and `OPTIONS`, and the public sign-in and sign-out are writes. With `WEB_ORIGIN` unset or empty, every write that carries an `Origin` is refused. Any other value that is not exactly an origin as a browser sends it, such as one with a trailing slash, capitals, a path or the literal `null`, stops the API at start ([`apps/api/test/web-origin-setting.test.ts`](../apps/api/test/web-origin-setting.test.ts)). A write with no `Origin`, which is how the web app's server calls the API, goes on to the guards. The check is applied with the request parsing at boot and in every end-to-end test ([`apps/api/src/config/origin-check.ts`](../apps/api/src/config/origin-check.ts), [`apps/api/test/origin-check.e2e.test.ts`](../apps/api/test/origin-check.e2e.test.ts)). It is not written to the refusal audit, because it comes before any session is read and any page on the web could trigger it.

Counted from the route declarations in `apps/api/src/`:

| Tier | Routes | Reads | Writes |
| --- | --- | --- | --- |
| Public | 3 | `GET /health` | `POST /auth/login`, `POST /auth/logout` |
| Any signed-in user | 42 | 36 | 6 |
| Role-gated | 30 | 2: `GET /admin/users` and `GET /admin/roles`, Admin only | 28 |
| No declaration | 0 | | |

**Reading is open to every signed-in user** except the two Admin pages. That is a design choice recorded in the [roles page](product/roles.md), and [`apps/api/test/every-role-reads-every-get.test.ts`](../apps/api/test/every-role-reads-every-get.test.ts) fails if a read route is narrowed without a decision.

**Six writes are open to any signed-in user**, also by design:

- `POST /orders` and `POST /orders/deliveries`: convert a quote into orders. Whoever receives the PO may create the order, and the company commits only at confirmation ([product decision 4](product/decisions.md), requirement R10). The quote page offers the act to Sales, but any signed-in user can call the route. In the demo the Production Manager's session converted a quote through the API and got 201.
- `PUT /orders/:id/purchase-order` and `POST /orders/:id/purchase-order/document`: record or correct the customer's PO number and attach the PO file, for the same reason.
- `POST /quoting/credit-approvals`: ask for a credit-hold exception. Deciding it is the Billing Manager's.
- `POST /quoting/tax-code-lookup`: look up the tax jurisdiction for an address. It changes nothing stored.

Everything else that writes needs a role, and a wrong role gets 403. The browser journey checks three of those refusals against the running API: Sales setting a lead time, the Production Manager pricing or sending a quote, and Sales confirming an order ([`tests/portfolio/quote-to-order.spec.ts`](../tests/portfolio/quote-to-order.spec.ts)). It also checks that requests with no session get 401.

## Sessions

- The session token is 32 random bytes. The server stores only its SHA-256 hash ([`modules/identity/src/domain/session.ts`](../modules/identity/src/domain/session.ts)).
- A session ends after 8 hours idle or 12 hours in total, adjustable with `SESSION_IDLE_TIMEOUT_MINUTES` and `SESSION_ABSOLUTE_TIMEOUT_MINUTES`.
- The cookie is `erp_session`: `httpOnly`, `SameSite=Lax`, path `/`, host-only, and `Secure` unless `SESSION_COOKIE_INSECURE=true` ([`apps/api/src/auth/auth.controller.ts`](../apps/api/src/auth/auth.controller.ts), [`apps/web/src/app/login/actions.ts`](../apps/web/src/app/login/actions.ts)).
- On its server-side calls to the API, the web app forwards the session cookie and no other cookie the browser holds ([`apps/web/src/lib/api-fetch.ts`](../apps/web/src/lib/api-fetch.ts)).
- The web app and the API run on two ports of the same host. A cookie is not scoped to a port, so the browser sends the session cookie to both. That is how the links to PDFs and uploaded files, which go straight to the API, are authenticated.
- Sign-in, sign-out and refusals are written to the API's output as audit events. A successful sign-in is recorded under the stored username, with the name typed in its detail when the two differ, so one search finds an account's sign-ins under either of its names ([`modules/identity/src/authentication-service.ts`](../modules/identity/src/authentication-service.ts)).

## How the demonstration signs in

`pnpm demo` runs [`scripts/demo.mjs`](../scripts/demo.mjs) with its settings in [`scripts/demo-config.mjs`](../scripts/demo-config.mjs).

- The API uses the local identity provider ([`modules/identity/src/providers/local-auth-provider.ts`](../modules/identity/src/providers/local-auth-provider.ts)). It accepts only the accounts named in `LOCAL_AUTH_USERS`, each of which must be one of the provider's fixed development accounts, and one password from `LOCAL_AUTH_PASSWORD`. It refuses to start without either. The launcher passes four accounts, `dev-sales`, `dev-production-manager`, `dev-billing` and `dev-admin`, and one shared password, written once in `scripts/demo-config.mjs`. Any other name, including the other development accounts, gets 401.
- At start the API gives each of the four accounts its one role (`DEV_SEED_ROLES=true`, [`modules/identity/src/dev-role-seed.ts`](../modules/identity/src/dev-role-seed.ts)).
- The sign-in page shows one button per account and no username and password form ([`apps/web/src/app/login/page.tsx`](../apps/web/src/app/login/page.tsx)). A button signs in through a server action that reads the password from the web process's environment ([`apps/web/src/app/login/demo-actions.ts`](../apps/web/src/app/login/demo-actions.ts)). The browser never sees it.
- The web app is in demonstration mode only when `PORTFOLIO_DEMO=true` and the API address is plain http on a loopback address ([`apps/web/src/lib/portfolio-demo.ts`](../apps/web/src/lib/portfolio-demo.ts)).
- [`tests/portfolio/demo-config.test.mjs`](../tests/portfolio/demo-config.test.mjs) fails if the accounts the API accepts and the buttons on the page differ, and if the password appears anywhere but the launcher.

### What refuses to run the demonstration settings in production

Each of these compares `NODE_ENV` to `production` and stops the API at start. The launcher runs the API with `NODE_ENV=test`.

| Refusal | Code | Test |
| --- | --- | --- |
| The local provider refuses production | [`modules/identity/src/domain/provider-guard.ts`](../modules/identity/src/domain/provider-guard.ts) | [`modules/identity/test/provider-guard.test.ts`](../modules/identity/test/provider-guard.test.ts) |
| The local provider refuses to start without a password or a list of accounts | [`modules/identity/src/domain/local-auth-config.ts`](../modules/identity/src/domain/local-auth-config.ts) | [`modules/identity/test/local-auth-config.test.ts`](../modules/identity/test/local-auth-config.test.ts) |
| Role seeding refuses production, any provider but local, and any storage but memory | [`modules/identity/src/domain/dev-role-guard.ts`](../modules/identity/src/domain/dev-role-guard.ts) | [`modules/identity/test/dev-role-guard.test.ts`](../modules/identity/test/dev-role-guard.test.ts) |
| In-memory storage refuses production | [`apps/api/src/config/persistence-guard.ts`](../apps/api/src/config/persistence-guard.ts) | [`apps/api/test/persistence-guard.test.ts`](../apps/api/test/persistence-guard.test.ts) |
| The fake tax lookup refuses production and PostgreSQL | [`apps/api/src/quoting/tax-code-lookup-mode.ts`](../apps/api/src/quoting/tax-code-lookup-mode.ts) | [`apps/api/test/tax-code-lookup-mode.test.ts`](../apps/api/test/tax-code-lookup-mode.test.ts) |
| Production with incomplete mail settings refuses to start | [`apps/api/src/notifications/notifications.factory.ts`](../apps/api/src/notifications/notifications.factory.ts) | [`apps/api/test/notifications.factory.test.ts`](../apps/api/test/notifications.factory.test.ts) |

## Where data lives and what the application connects to

| | Under `pnpm demo` | Without the launcher |
| --- | --- | --- |
| Listens on | `127.0.0.1` only, web on port 4330 and API on 4331 unless `PORTFOLIO_WEB_PORT` and `PORTFOLIO_API_PORT` say otherwise. The launcher checks both ports are free first | The API defaults to `127.0.0.1:3001` unless `API_HOST` and `API_PORT` say otherwise ([`apps/api/src/config/listen-address.ts`](../apps/api/src/config/listen-address.ts)). The web app's start scripts bind `127.0.0.1` |
| Data | In the API's memory, every module. Generated PDFs and uploaded PO files are held in memory too. Nothing is written to disk, and stopping the demo discards everything | PostgreSQL when `DATABASE_URL` is set, with files under `DOCUMENT_STORAGE_ROOT` |
| Sign-in | The local provider and the four demo accounts | The company directory over LDAP when `AUTH_PROVIDER=ldap` and its settings are given |
| Mail | Printed to the launcher's terminal, never sent | Sent over SMTP only with PostgreSQL storage and all four required `SMTP_*` settings. The connection is always encrypted, with implicit TLS on port 465 and required STARTTLS on any other port, and the relay's certificate is always verified. `SMTP_CA_FILE` names the certificates to trust for a relay with a private certificate. No setting turns encryption or verification off |
| Tax lookup | An in-memory stand-in | A live lookup only when `TAX_CODE_LOOKUP_URL` is an https address |

The launcher starts each process with a short allowlist of environment variables and a fixed set of its own, refuses to start if an `.env` file is present, and seeds two fictional customers. `tests/portfolio/demo-config.test.mjs` checks the exact settings each process receives. [`apps/api/test/documents.factory.test.ts`](../apps/api/test/documents.factory.test.ts) checks that rendering a PDF and storing an upload leave the temporary folder empty.

## Honest limits

- **The isolation is the launcher's.** Started without the launcher, in a shell that carries real settings, the API follows them: a `DATABASE_URL` makes it use that database, LDAP settings make it bind to that directory, PostgreSQL with `SMTP_*` sends real mail. "The demo reaches nothing outside this machine" is true of `pnpm demo`, not of the application under any environment.
- **Mail is protected as far as the relay.** The API encrypts and verifies its own connection to the relay. It sends no credentials there, and how the relay delivers onward is the relay's configuration.
- **Cross-site requests are stopped by the Origin check and the cookie.** The API refuses a write from a browser page on another origin, as described above, and the session cookie is `SameSite=Lax`. It uses no CSRF token and makes no Host check. A write with no `Origin` header is decided by the session and role guards alone. CORS allows exactly the web app's origin, which limits who can read a response. Changes made through the web app go through Next.js server actions, which carry the framework's own origin check.
- **The demo cookie is not `Secure`**, because the demo is plain http on the local machine.
- **One shared password, no lockout.** The local provider has no lockout. The emergency break-glass account, which has one, is not set up in the demo.
- **Conversion and the PO are open to any signed-in user**, as described above. That is the business rule, not an oversight, and it means a Production Manager can create an order even though the screen offers conversion to Sales.
