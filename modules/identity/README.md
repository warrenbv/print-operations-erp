# Identity module

## What it is responsible for

Identity decides who is signed in and which roles they hold. It checks a username and password through an authentication provider, issues and resolves server-side sessions, keeps the user records and their role assignments, and runs the break-glass administrator account. It does not decide what a role may do. The API guards each route.

## Public surface

Other code imports only from `@erp/identity`, which is [src/index.ts](src/index.ts). The lint rule in [packages/config/eslint/boundaries.mjs](../../packages/config/eslint/boundaries.mjs) refuses imports of `src/` paths.

- `AuthenticationService`: `login`, `resolveSession`, `logout` and `recordAuthorizationDenied`.
- `AdminRoleService`: searches the directory and sets a user's roles.
- The two providers, `LdapAuthProvider` and `LocalAuthProvider`, and the directories the Admin page searches, `LdaptsLdapDirectory` and `LocalLdapDirectory`.
- The start-up guards `resolveAuthProviderName`, `resolveLocalAuthPassword`, `resolveLocalAuthRoster`, `resolveDevRoleSeeding` and `resolveLdapConfig`.
- The ports in [src/ports.ts](src/ports.ts) and both adapter sets, in-memory and PostgreSQL.

The provider port `AuthProvider`, the role list and the sign-in shapes are in [packages/types/src/auth.ts](../../packages/types/src/auth.ts) and [packages/types/src/roles.ts](../../packages/types/src/roles.ts). The API wires the module in [apps/api/src/auth/auth.factory.ts](../../apps/api/src/auth/auth.factory.ts) and [apps/api/src/admin/admin.factory.ts](../../apps/api/src/admin/admin.factory.ts), and chooses the adapters there from `DATA_PERSISTENCE`: [docs/decisions/007-persistence-switch-at-the-composition-root.md](../../docs/decisions/007-persistence-switch-at-the-composition-root.md).

## State it owns

The PostgreSQL schema `identity`, defined in [src/data/schema.ts](src/data/schema.ts) and created by [infra/db/migrations/identity/0000_baseline.sql](../../infra/db/migrations/identity/0000_baseline.sql):

- `users`: one row per person the directory has verified, keyed by the directory's external id, with the role list.
- `sessions`: one row per live session, holding the token's hash and never the token. Deleting a user deletes their sessions.
- `break_glass`: the single break-glass credential, its consecutive failure count and any lock.

It owns no state machine. A session is live until it passes its idle or absolute limit or is deleted.

## Rules it enforces

- A session token is 32 random bytes. Only its SHA-256 hash is stored. A session ends at the earlier of an idle limit, refreshed by use, and an absolute limit that is never refreshed: [docs/decisions/005-server-side-sessions.md](../../docs/decisions/005-server-side-sessions.md).
- Roles are read from the user record on every request, so a role change takes effect at once. The same record 005 applies.
- A sign-in creates the user with no roles when no Admin grant has created them first. Every sign-in sets the username, display name and email from the directory and leaves the roles alone. Only an Admin assigns roles, and the ERP never creates directory accounts or sets passwords: [docs/product/roles.md](../../docs/product/roles.md).
- An Admin role grant never changes a stored username. For a user who exists it sets the roles and refreshes the display name and email from the identity the Admin page sends. A person who has never signed in is created by the grant from that identity, with its roles, and it is not checked against the directory again. That username stands until the first sign-in replaces it with the entry's account name, and no session exists before that sign-in. The grant refuses as `directory-mismatch` the break-glass account's external id and an identity whose username is the reserved break-glass name.
- The directory provider connects only over `ldaps://` with a configured CA certificate, escapes every filter value, and refuses a disabled directory account as bad credentials.
- A person may sign in to the directory under the account name (`sAMAccountName`) or the principal name (`userPrincipalName`). A sign-in stores the entry's account name, trimmed and lower-case, as the username, so one account has one username under either name. An entry with no account name is refused as bad credentials, and so is an identity whose account name is the break-glass account's reserved name or whose external id is the break-glass account's: the refusal is audited as a failed sign-in and nothing is stored. A successful sign-in is audited under the stored username, with the name typed in the event's detail when the two differ. The API's read-only rule matches that username: [apps/api/src/auth/roles.guard.ts](../../apps/api/src/auth/roles.guard.ts).
- The local provider refuses to start when `NODE_ENV` is `production`. It also refuses to start without `LOCAL_AUTH_PASSWORD`, or without `LOCAL_AUTH_USERS` naming accounts from its fixed list with none repeated.
- Seeding roles for the local accounts runs only when `DEV_SEED_ROLES` is `true`, with the local provider, in-memory storage and a `NODE_ENV` other than `production`. With the flag set to `true` under any other combination, or set to any other value, the API refuses to start.
- The break-glass account is checked before the provider, so it works when the directory is down: [docs/decisions/009-technology-stack.md](../../docs/decisions/009-technology-stack.md). It holds the Admin role without storing it. It locks for a fixed window after a set number of consecutive failures, answers a lock with the same failure as a wrong password, and raises an alert on every success and when it locks. Only setting the password writes its hash. A sign-in records its failure or success in one step on the stored record, so overlapping failures all count, and a sign-in whose password was replaced while it was being checked is refused. It is left out of the Admin page's search and role lists, and the role grant refuses it.

## Where to start reading

- [src/authentication-service.ts](src/authentication-service.ts): sign-in, session resolution, break-glass and the audit trail.
- [src/domain/session.ts](src/domain/session.ts): token generation, hashing and the two expiry limits.
- [src/domain/provider-guard.ts](src/domain/provider-guard.ts), [src/domain/local-auth-config.ts](src/domain/local-auth-config.ts) and [src/domain/dev-role-guard.ts](src/domain/dev-role-guard.ts): what refuses to start, and when.
- [src/providers/ldap-auth-provider.ts](src/providers/ldap-auth-provider.ts): the directory bind and its failover across endpoints.
- [src/admin-role-service.ts](src/admin-role-service.ts): role assignment and its audit events.
- [apps/api/src/auth/session.guard.ts](../../apps/api/src/auth/session.guard.ts) and [apps/api/src/auth/roles.guard.ts](../../apps/api/src/auth/roles.guard.ts): where the API calls this module on each request.

Two command-line tools are built from [src/cli/](src/cli/): `break-glass:set` sets or rotates the break-glass password at a hidden prompt, and `ldap:probe` checks the directory settings.

## Tests

- Unit tests cover the session arithmetic, the lockout rules, the start-up guards, username handling, filter escaping and the LDAP configuration.
- Service tests run `AuthenticationService` and `AdminRoleService` on the in-memory adapters with a clock the test controls.
- Provider tests run the directory provider, the directory search and the probe against a scripted LDAP client, and the `ldapts` adapter against a mocked library.
- [test/directory-sign-in-names.test.ts](test/directory-sign-in-names.test.ts) signs one directory account in under both of its names on both user repository adapters, the PostgreSQL half only with `DATABASE_URL`.
- [test/admin-grant-keeps-the-stored-name.test.ts](test/admin-grant-keeps-the-stored-name.test.ts) runs `AdminRoleService` grants on both user repository adapters, the PostgreSQL half only with `DATABASE_URL`.
- [test/drizzle-adapters.test.ts](test/drizzle-adapters.test.ts) runs the PostgreSQL adapters against a real database, including a session issued by one service instance and resolved by another, and twenty break-glass failures recorded at once. It skips without `DATABASE_URL`. There is no shared contract suite for the user and session ports. Their in-memory adapters have their own tests.
- [test/break-glass-contracts.test.ts](test/break-glass-contracts.test.ts) runs one contract for the break-glass store against both adapters, the PostgreSQL one under `pnpm test:db`. It drives sign-in through `AuthenticationService` with a hasher that holds each check until the test releases it, so overlapping sign-ins, a password change in the middle of one, and failures that lock the account while a right password is being checked are tested in a fixed order.

`pnpm test` runs every package with no database. `pnpm test:db` runs the same suite against a throwaway local Postgres, which includes the PostgreSQL adapter tests.
