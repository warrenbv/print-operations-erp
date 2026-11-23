# API

## What it is responsible for

The API is the NestJS application that composes the modules and serves them over HTTP. It is thin by design. Controllers validate input, check roles and map module errors to HTTP replies, and one factory per module is the composition root that chooses the in-memory or PostgreSQL adapters and fills the module's ports: [docs/decisions/001-modular-monorepo.md](../../docs/decisions/001-modular-monorepo.md) and [docs/decisions/007-persistence-switch-at-the-composition-root.md](../../docs/decisions/007-persistence-switch-at-the-composition-root.md).

## Public surface

- HTTP routes only. No package imports this application, and the web app reaches it through `fetch`.
- Request and response bodies are the Zod schemas in `packages/types`. Every controller parses its input with them and parses its reply before returning it.
- The factories may import any module's public entry point. When one module needs another, the factory supplies the port in the consumer's own shape, field by field: [docs/decisions/002-what-crosses-a-module-boundary.md](../../docs/decisions/002-what-crosses-a-module-boundary.md).

## State it owns

None of its own. Each module owns its schema and its state machine. The API holds the stores the factories build, and closes each pool when Nest shuts the module down. In memory mode every store, the session store and the stored documents among them, lives in the process and is gone on restart.

## Rules it enforces

- A write that carries an `Origin` header other than `WEB_ORIGIN` is refused with 403 `foreign-origin` before its body or upload is read, the public sign-in and sign-out included. A write is any method but `GET`, `HEAD` and `OPTIONS`. With `WEB_ORIGIN` unset or empty, a write that carries any `Origin` is refused. A write with no `Origin`, as the web app's server sends it, goes on to the guards: [`src/config/origin-check.ts`](src/config/origin-check.ts).
- Every request passes two global guards in order, `SessionGuard` then `RolesGuard`. The session is a server-side record looked up from an `httpOnly` cookie on every request: [docs/decisions/005-server-side-sessions.md](../../docs/decisions/005-server-side-sessions.md).
- Role checks deny by default. A route must carry `@Public()`, `@Authenticated()` or `@RequireRoles(...)` from [`src/auth/authz.decorators.ts`](src/auth/authz.decorators.ts). A route with none of them, or an empty role list, is refused with 403 and the refusal is audited. `@RequireRoles` admits a user holding any one of the roles listed.
- The role lists are the per-act constants in `packages/types/src/roles.ts`, which follow [docs/product/roles.md](../../docs/product/roles.md). One gate is written inline: granting roles (`Admin`). A grant never changes a stored username, and refuses with 400 `directory-mismatch` the break-glass account's external id and an identity whose username is the reserved break-glass name: [modules/identity/README.md](../../modules/identity/README.md). The credit-hold exception decision uses `CREDIT_HOLD_ROLES`, the same list as setting the hold.
- The route census, counted from the controllers: 75 routes. 3 are public (sign-in, sign-out and the health check). 42 are open to any signed-in user: 36 reads and 6 writes. 30 are role-gated: 28 writes and the 2 reads of the Admin section.
- Reading is open to every signed-in user except in the Admin section: [docs/product/roles.md](../../docs/product/roles.md).
- Four of the six open writes are order intake: converting a quote (`POST /orders`, `POST /orders/deliveries`) and recording the PO and its document. Whoever receives the PO may do this, and the converter is recorded from the session: [docs/product/requirements.md](../../docs/product/requirements.md) (R10) and [docs/product/decisions.md](../../docs/product/decisions.md). The other two are asking for a credit-hold exception and the tax code lookup, which stores nothing.
- An account named in `READ_ONLY_USERS` is refused every route that is not GET or HEAD, whatever its tier, except the public ones. Each entry is an account name, the directory's `sAMAccountName` or a local account's name. A directory account is stored under its account name whichever of its sign-in names was typed, so the rule holds under both. An entry holding `@` or `\` stops the API at start.
- A write that carries a stale `lockVersion` is answered 409 `stale-aggregate`: [docs/decisions/006-optimistic-concurrency.md](../../docs/decisions/006-optimistic-concurrency.md).
- Every id in a path is parsed as a UUID, and a malformed one is answered 404 rather than reaching the database.
- A send carries the recipient list the person confirmed. If the tagged contacts changed since the page rendered, nothing is sent and the reply is 409 `recipient-changed`.
- The process refuses to start on configuration it cannot trust. [`src/config/persistence-guard.ts`](src/config/persistence-guard.ts) refuses memory storage in production and PostgreSQL with no `DATABASE_URL`. The identity module refuses a missing `AUTH_PROVIDER`, the local provider in production, and the local provider without `LOCAL_AUTH_PASSWORD` or without a `LOCAL_AUTH_USERS` roster drawn from its fixed account names. The auth factory refuses a `READ_ONLY_USERS` entry holding `@` or `\`. The request handling refuses a `WEB_ORIGIN` that is set and is not exactly an origin as a browser sends it: scheme, lower-case host and any non-default port, with no path and no trailing slash. The documents factory refuses an unwritable `DOCUMENT_STORAGE_ROOT` on PostgreSQL. The mail factory refuses production without the four required `SMTP_` keys. In any mode it refuses an `SMTP_CA_FILE` that is set and is not a readable bundle of PEM certificates, and an allow list with no catch-all address.

## Controllers by module

| Controller file                                                                              | Route prefix                         | Module it fronts                                            |
| -------------------------------------------------------------------------------------------- | ------------------------------------ | ----------------------------------------------------------- |
| [`src/auth/auth.controller.ts`](src/auth/auth.controller.ts)                                 | `auth`                               | identity                                                    |
| [`src/admin/admin.controller.ts`](src/admin/admin.controller.ts)                             | `admin/users`                        | identity                                                    |
| [`src/admin/role-catalog.controller.ts`](src/admin/role-catalog.controller.ts)               | `admin/roles`                        | identity, with the notifications send log                   |
| [`src/crm/crm.controller.ts`](src/crm/crm.controller.ts)                                     | `crm/customers`                      | crm                                                         |
| [`src/crm/crm-contact.controller.ts`](src/crm/crm-contact.controller.ts)                     | `crm/customers/:customerId/contacts` | crm                                                         |
| [`src/crm/crm-customer-defaults.controller.ts`](src/crm/crm-customer-defaults.controller.ts) | `crm/customers/:customerId/defaults` | crm                                                         |
| [`src/crm/crm-agreed-price.controller.ts`](src/crm/crm-agreed-price.controller.ts)           | `crm/customers/:customerId/parts`    | crm                                                         |
| [`src/crm/sales-reps.controller.ts`](src/crm/sales-reps.controller.ts)                       | `sales-reps`                         | identity (the holders of the Sales role)                    |
| [`src/quoting/quotes.controller.ts`](src/quoting/quotes.controller.ts)                       | `quoting/quotes`                     | quoting, with documents and notifications                   |
| [`src/quoting/catalog.controller.ts`](src/quoting/catalog.controller.ts)                     | `quoting`                            | quoting (grades, pallet fits, tiers, pricing configuration) |
| [`src/quoting/credit-approvals.controller.ts`](src/quoting/credit-approvals.controller.ts)   | `quoting/credit-approvals`           | quoting                                                     |
| [`src/quoting/tax-rates.controller.ts`](src/quoting/tax-rates.controller.ts)                 | `quoting/tax-rates`                  | quoting                                                     |
| [`src/quoting/tax-code-lookup.controller.ts`](src/quoting/tax-code-lookup.controller.ts)     | `quoting/tax-code-lookup`            | quoting                                                     |
| [`src/approvals/approvals.controller.ts`](src/approvals/approvals.controller.ts)             | `approvals`                          | quoting                                                     |
| [`src/orders/orders.controller.ts`](src/orders/orders.controller.ts)                         | `orders`                             | orders, with documents and notifications                    |
| [`src/notifications/mail-mode.controller.ts`](src/notifications/mail-mode.controller.ts)     | `notifications/mail-mode`            | notifications                                               |
| [`src/health/health.controller.ts`](src/health/health.controller.ts)                         | `health`                             | none, the process itself                                    |

## Where to start reading

- [`src/auth/roles.guard.ts`](src/auth/roles.guard.ts): the default-deny role check and the read-only rule.
- [`src/config/persistence-guard.ts`](src/config/persistence-guard.ts): the storage switch every factory calls.
- [`src/config/request-parsing.ts`](src/config/request-parsing.ts): how a query string and an empty body are read, and the foreign-origin write refusal from [`src/config/origin-check.ts`](src/config/origin-check.ts), applied at boot and in every end-to-end test.
- [`src/quoting/quoting.factory.ts`](src/quoting/quoting.factory.ts): the largest composition root, filling quoting's ports from crm, orders, identity, documents and notifications.
- [`src/orders/orders.factory.ts`](src/orders/orders.factory.ts): the field-by-field copy of a quote line into an order line.
- [`src/quoting/quotes.controller.ts`](src/quoting/quotes.controller.ts): a full controller, from role gate to error mapping.
- [`test/every-role-reads-every-get.test.ts`](test/every-role-reads-every-get.test.ts): the census of authorization tiers.

## Tests

- Unit tests call one function or guard directly: the guards, the configuration resolvers, the mail helpers and the factories.
- End-to-end tests (`*.e2e.test.ts`) boot the Nest modules on in-memory stores with the local sign-in provider and drive them over HTTP with supertest. They prove the role gates, the validation and the error mapping route by route.
- Structural census tests parse the source and fail when a convention is broken: `every-id-param-is-a-uuid`, `every-in-memory-id-is-a-uuid`, `every-role-reads-every-get`, `every-send-confirms-its-recipient`, `every-write-route-has-a-screen`, `every-e2e-app-listens-on-loopback`, `every-e2e-app-reads-requests-as-the-process-does`, `read-only-refuses-every-write`, `one-clock-at-the-root` and `production-role-convention`. Why they exist: [docs/process/verifying-agent-written-code.md](../../docs/process/verifying-agent-written-code.md).
- `pnpm test` runs every package with no database. `pnpm test:db` runs the same suite against a throwaway local PostgreSQL. The API's own tests run on in-memory stores in both.
