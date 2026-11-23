// Sign-in, session resolution, sign-out and the break-glass account. Sessions are server-side and only
// a hash of the token is stored: docs/decisions/005-server-side-sessions.md. The API calls this from
// apps/api/src/auth/auth.controller.ts, apps/api/src/auth/session.guard.ts and
// apps/api/src/auth/roles.guard.ts.
import type { AuthFailureReason, AuthProvider, ErpRole } from '@erp/types';

import { DEFAULT_LOCKOUT_POLICY, isLockedOut, type LockoutPolicy } from './domain/break-glass';
import {
  DEFAULT_SESSION_POLICY,
  generateSessionToken,
  hashSessionToken,
  isSessionExpired,
  sessionExpiresAt,
  type SessionPolicy,
} from './domain/session';
import { isBreakGlassUsername, normalizeUsername } from './domain/username';
import type {
  AlertSink,
  AuditEventType,
  AuditSink,
  BreakGlassStore,
  Clock,
  ErpUser,
  PasswordHasher,
  SessionRecord,
  SessionStore,
  UserRepository,
} from './ports';

/** The external id of the break-glass user. The Admin page's search and role lists leave it out. */
export const BREAK_GLASS_EXTERNAL_ID = 'break-glass';

/** The role the break-glass user holds. It is applied when the user is read and never stored. */
export const BREAK_GLASS_ROLE: ErpRole = 'Admin';

// A session's last-seen time is written at most once a minute, not on every request. The idle limit can
// therefore fall up to a minute before a strict reading of it.
const TOUCH_THROTTLE_MS = 60_000;

export interface LoginContext {
  sourceIp?: string;
}

export type LoginOutcome =
  | { ok: true; token: string; user: ErpUser; expiresAt: Date }
  | { ok: false; reason: AuthFailureReason };

export interface ResolvedSession {
  session: SessionRecord;
  user: ErpUser;
}

export interface AuthenticationServiceOptions {
  provider: AuthProvider;
  users: UserRepository;
  sessions: SessionStore;
  breakGlass: BreakGlassStore;
  hasher: PasswordHasher;
  audit: AuditSink;
  alerts: AlertSink;
  clock: Clock;
  breakGlassUsername: string;
  sessionPolicy?: SessionPolicy;
  lockoutPolicy?: LockoutPolicy;
}

export class AuthenticationService {
  readonly #o: AuthenticationServiceOptions;
  readonly #sessionPolicy: SessionPolicy;
  readonly #lockoutPolicy: LockoutPolicy;

  constructor(options: AuthenticationServiceOptions) {
    this.#o = options;
    this.#sessionPolicy = options.sessionPolicy ?? DEFAULT_SESSION_POLICY;
    this.#lockoutPolicy = options.lockoutPolicy ?? DEFAULT_LOCKOUT_POLICY;
  }

  async login(
    rawUsername: string,
    password: string,
    context: LoginContext = {},
  ): Promise<LoginOutcome> {
    const username = normalizeUsername(rawUsername);

    // Checked before the provider is asked, so break-glass still works when the directory is down.
    if (isBreakGlassUsername(username, this.#o.breakGlassUsername)) {
      return this.#loginBreakGlass(username, password, context);
    }

    const result = await this.#o.provider.authenticate(username, password);
    if (!result.ok) {
      await this.#audit(
        result.reason === 'directory-unreachable' ? 'login.directory-unreachable' : 'login.failed',
        username,
        context,
      );
      return { ok: false, reason: result.reason };
    }

    // The provider's identity is stored under its own name, so one carrying the break-glass account's name
    // or external id would become that account. It is refused before anything is stored.
    if (
      isBreakGlassUsername(result.identity.username, this.#o.breakGlassUsername) ||
      result.identity.externalId === BREAK_GLASS_EXTERNAL_ID
    ) {
      await this.#audit('login.failed', username, context, {
        detail: `refused: the directory identity carries the break-glass name or id externalId=${result.identity.externalId}`,
      });
      return { ok: false, reason: 'invalid-credentials' };
    }

    const user = await this.#o.users.upsertFromIdentity(result.identity);
    const { token, expiresAt } = await this.#issueSession(user);
    // Audited under the stored username, so a search for an account finds its sign-ins under every name.
    await this.#audit('login.succeeded', user.username, context, {
      userId: user.id,
      ...(user.username === username ? {} : { detail: `typed=${username}` }),
    });
    return { ok: true, token, user: applyImplicitRoles(user), expiresAt };
  }

  /**
   * The user behind a session token, or null. An expired session, or one whose user no longer exists,
   * is deleted as it is found. The user and roles are read fresh each time, so a role change applies
   * on the next request: docs/decisions/005-server-side-sessions.md.
   */
  async resolveSession(token: string): Promise<ResolvedSession | null> {
    const now = this.#o.clock.now();
    const session = await this.#o.sessions.findByTokenHash(hashSessionToken(token));
    if (session === null) {
      return null;
    }
    if (isSessionExpired(session, this.#sessionPolicy, now)) {
      await this.#o.sessions.delete(session.id);
      return null;
    }

    let current = session;
    if (now.getTime() - session.lastSeenAt.getTime() >= TOUCH_THROTTLE_MS) {
      await this.#o.sessions.touch(session.id, now);
      current = { ...session, lastSeenAt: now };
    }

    const user = await this.#o.users.findById(session.userId);
    if (user === null) {
      await this.#o.sessions.delete(session.id);
      return null;
    }
    return { session: current, user: applyImplicitRoles(user) };
  }

  async logout(token: string, context: LoginContext = {}): Promise<void> {
    const session = await this.#o.sessions.findByTokenHash(hashSessionToken(token));
    if (session === null) {
      return;
    }
    await this.#o.sessions.delete(session.id);
    const user = await this.#o.users.findById(session.userId);
    await this.#audit('logout', user?.username ?? '', context, { userId: session.userId });
  }

  /**
   * Audits a refusal by apps/api/src/auth/roles.guard.ts. An empty `requiredRoles` with no `cause` means
   * the route declared no access rule and was refused by default.
   */
  async recordAuthorizationDenied(
    user: ErpUser,
    route: string,
    requiredRoles: readonly ErpRole[],
    context: LoginContext = {},
    cause?: string,
  ): Promise<void> {
    const detail =
      cause !== undefined
        ? `route=${route} refused: ${cause}`
        : requiredRoles.length === 0
          ? `route=${route} default-deny (no @RequireRoles / @Public / @Authenticated)`
          : `route=${route} required=${requiredRoles.join(',')} held=${user.roles.join(',') || '(none)'}`;
    await this.#audit('authorization.denied', user.username, context, {
      userId: user.id,
      detail,
    });
  }

  async #loginBreakGlass(
    username: string,
    password: string,
    context: LoginContext,
  ): Promise<LoginOutcome> {
    const now = this.#o.clock.now();
    const record = await this.#o.breakGlass.load();

    // Every refusal below answers `invalid-credentials`, so a caller cannot tell an unset credential,
    // a lock or a wrong password apart. The audit trail records which it was.
    if (record === null) {
      await this.#audit('break-glass.unprovisioned', username, context);
      return { ok: false, reason: 'invalid-credentials' };
    }

    // While locked even the correct password is refused, and the attempt does not count as a failure.
    if (isLockedOut(record, now)) {
      await this.#audit('break-glass.locked-out', username, context, {
        detail: `locked until ${record.lockedUntil?.toISOString() ?? 'unknown'}`,
      });
      return { ok: false, reason: 'invalid-credentials' };
    }

    // The bookkeeping below goes through the store's one-step operations, never a write of the record
    // read above, so a password set while the slow hash runs stays set: modules/identity/src/ports.ts.
    if (!(await this.#o.hasher.verify(record.passwordHash, password))) {
      const counted = await this.#o.breakGlass.recordFailure(this.#lockoutPolicy, now);
      if (counted === null) {
        await this.#audit('break-glass.unprovisioned', username, context);
        return { ok: false, reason: 'invalid-credentials' };
      }
      await this.#audit('break-glass.failed', username, context, {
        detail: `consecutive failures: ${counted.after.consecutiveFailures}`,
      });
      // Alerts once, on the failure that takes the stored record from unlocked to locked.
      if (!isLockedOut(counted.before, now) && isLockedOut(counted.after, now)) {
        await this.#o.alerts.raise({
          type: 'break-glass.locked-out',
          message: `Break-glass account locked after ${counted.after.consecutiveFailures} consecutive failures.`,
          at: now,
        });
      }
      return { ok: false, reason: 'invalid-credentials' };
    }

    // The password matched the hash read above. It counts only if that hash is still the stored one
    // and no overlapping failure has locked the account since.
    const success = await this.#o.breakGlass.recordSuccess(record.passwordHash, now);
    if (!success.applied) {
      if (success.current === null) {
        await this.#audit('break-glass.unprovisioned', username, context);
      } else if (isLockedOut(success.current, now)) {
        await this.#audit('break-glass.locked-out', username, context, {
          detail: `locked until ${success.current.lockedUntil?.toISOString() ?? 'unknown'}`,
        });
      } else {
        // The password was replaced while this sign-in verified it. That is not a guess, so it is not
        // counted as a failure.
        await this.#audit('break-glass.failed', username, context, {
          detail: 'password replaced during sign-in',
        });
      }
      return { ok: false, reason: 'invalid-credentials' };
    }

    const user = await this.#o.users.upsertFromIdentity({
      externalId: BREAK_GLASS_EXTERNAL_ID,
      username,
      displayName: 'Break-glass administrator',
    });
    const { token, expiresAt } = await this.#issueSession(user);
    await this.#audit('break-glass.succeeded', username, context, { userId: user.id });

    // A successful sign-in on this account is alerted as well as audited.
    await this.#o.alerts.raise({
      type: 'break-glass.used',
      message: `Break-glass login succeeded${context.sourceIp === undefined ? '' : ` from ${context.sourceIp}`}.`,
      at: now,
    });
    return { ok: true, token, user: applyImplicitRoles(user), expiresAt };
  }

  async #issueSession(user: ErpUser): Promise<{ token: string; expiresAt: Date }> {
    const now = this.#o.clock.now();
    const token = generateSessionToken();
    const session = await this.#o.sessions.create({
      tokenHash: hashSessionToken(token),
      userId: user.id,
      issuedAt: now,
      lastSeenAt: now,
      absoluteExpiresAt: new Date(now.getTime() + this.#sessionPolicy.absoluteLifetimeMs),
    });
    return { token, expiresAt: sessionExpiresAt(session, this.#sessionPolicy) };
  }

  async #audit(
    type: AuditEventType,
    username: string,
    context: LoginContext,
    extra: { userId?: string; detail?: string } = {},
  ): Promise<void> {
    await this.#o.audit.record({
      type,
      username,
      at: this.#o.clock.now(),
      ...(context.sourceIp === undefined ? {} : { sourceIp: context.sourceIp }),
      ...(extra.userId === undefined ? {} : { userId: extra.userId }),
      ...(extra.detail === undefined ? {} : { detail: extra.detail }),
    });
  }
}

function applyImplicitRoles(user: ErpUser): ErpUser {
  return user.externalId === BREAK_GLASS_EXTERNAL_ID
    ? { ...user, roles: [BREAK_GLASS_ROLE] }
    : user;
}
