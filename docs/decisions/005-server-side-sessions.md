# 005. Server-side sessions, not tokens

Status: Accepted. Decided by Warren Vogel, project owner.

## Context

Earlier decisions settled who verifies credentials (the company directory) and the emergency access path. Neither said how the browser proves, on the next request, that it already signed in. Every authenticated request in every future module would inherit that answer's cost and revocation behaviour.

The forces:

- **Revocation was a stated requirement.** Directory sign-in was chosen partly so that disabling a directory account stops that account signing in to the ERP. Ending access already granted needs a credential the server can invalidate.
- **Scale was small and fixed.** A small number of internal users, one first-party web client, one API process. There was no third-party client, mobile app or cross-domain consumer.
- **PostgreSQL was already a hard dependency**, so session state added no new infrastructure.
- **Secret handling fell on a small team.** Every new class of key to generate, store and rotate would land there.

## Decision

Issue server-side sessions identified by an opaque random token, delivered in an `httpOnly` cookie, with session state held by the server.

- The token is 32 random bytes, base64url-encoded. It carries no claims and is only a lookup key.
- The store keeps a SHA-256 hash of the token, never the token, so a database dump yields no usable sessions. A fast hash is right because the token is high-entropy and random.
- The cookie is `httpOnly`, `SameSite=Lax` and `Secure`. The web app and API share an origin.
- Expiry has two limits: an idle timeout refreshed on each request, and an absolute lifetime that is never refreshed. The defaults are 8 and 12 hours, one shift plus overtime.
- Deleting the session row ends the session on the next request.

## Alternatives considered

- **A stateless JWT in a cookie.** No lookup, and free horizontal scaling. Rejected on revocation: the server cannot end a token before it expires, and role claims go stale. Every fix, short lifetimes with refresh or a denylist, brings back server-side state and adds a signing key to manage.
- **Access and refresh tokens.** The right shape for public APIs with many clients. Rejected as premature. It solves distribution problems this system did not have.

## Consequences

- Deleting a session row ends that session on its next request. A disabled directory account is refused at its next sign-in. A session it already holds is not checked against the directory, and lasts until its idle or absolute limit unless its row is deleted.
- No signing key exists, so none can leak or need rotation.
- Roles are read on every request, so a role change takes effect at once.
- Every authenticated request costs one indexed database read. The application is unusable without its database in any case, so this adds no new failure mode.
- The idle timeout is a real trade-off. A long window does little for an unlocked, unattended workstation. A short one interrupts staff who use the system in bursts. The default favours usability and treats workstation locking as the operating system's job.

## In this edition

The demo signs in through the local identity provider instead of the company directory, and keeps sessions in memory. It serves plain HTTP on the local machine, so its launcher turns off the cookie's `Secure` flag through a setting. The web app and the API listen on two ports of `127.0.0.1` rather than sharing one origin. A cookie is not scoped to a port, so the browser sends the session cookie to both. The API also refuses a write that carries a browser `Origin` other than the web app's, before the session is read: [`apps/api/src/config/origin-check.ts`](../../apps/api/src/config/origin-check.ts). The session model and the role checks are otherwise the same. What this means for the demo is set out in [Security and access](../security-and-access.md).

## Where to see it

- [`modules/identity/src/domain/session.ts`](../../modules/identity/src/domain/session.ts): token generation, hashing and the two expiry limits.
- [`modules/identity/src/adapters/in-memory/`](../../modules/identity/src/adapters/in-memory/) and [`modules/identity/src/adapters/drizzle/`](../../modules/identity/src/adapters/drizzle/): the two session stores behind one port.
- [`apps/api/src/auth/session.guard.ts`](../../apps/api/src/auth/session.guard.ts) and [`apps/api/src/auth/roles.guard.ts`](../../apps/api/src/auth/roles.guard.ts): the per-request session and role checks.
