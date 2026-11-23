// The ports identity's services depend on. Each store has an in-memory and a PostgreSQL adapter under
// modules/identity/src/adapters/, chosen at the composition root:
// docs/decisions/007-persistence-switch-at-the-composition-root.md.
import type { ErpRole, VerifiedIdentity } from '@erp/types';

import type { LockoutPolicy } from './domain/break-glass';

export interface Clock {
  now(): Date;
}

export interface PasswordHasher {
  hash(plaintext: string): Promise<string>;
  verify(hash: string, plaintext: string): Promise<boolean>;
}

export interface ErpUser {
  id: string;
  externalId: string;
  username: string;
  displayName: string;
  email?: string;
  roles: readonly ErpRole[];
}

/**
 * Users keyed by the directory's external id. `upsertFromIdentity` creates a user with no roles and,
 * for an existing user, refreshes name and email and leaves the roles alone. Sign-in calls it.
 */
export interface UserRepository {
  upsertFromIdentity(identity: VerifiedIdentity): Promise<ErpUser>;

  // Creates a user with no roles when none has this external id. For a user who exists, refreshes the
  // display name and email and leaves the username and the roles alone. The PostgreSQL adapter does this
  // in one statement, and the in-memory adapter with nothing awaited between its read and its write. The
  // Admin role grant calls it, so a grant never renames anyone.
  upsertKeepingUsername(identity: VerifiedIdentity): Promise<ErpUser>;
  findById(id: string): Promise<ErpUser | null>;

  findByExternalId(externalId: string): Promise<ErpUser | null>;

  // A username is not unique across rows. When two rows carry one, the most recently written row is
  // the answer, here and in `findByUsernames`.
  findByUsername(username: string): Promise<ErpUser | null>;

  findByUsernames(usernames: readonly string[]): Promise<readonly ErpUser[]>;

  // Replaces the whole role set, dropping duplicates. Returns null for an unknown id.
  setRoles(id: string, roles: readonly ErpRole[]): Promise<ErpUser | null>;

  listByRole(role: ErpRole): Promise<readonly ErpUser[]>;
}

export interface SessionRecord {
  id: string;

  // The SHA-256 hash of the session token. The token itself is never stored:
  // docs/decisions/005-server-side-sessions.md.
  tokenHash: string;
  userId: string;
  issuedAt: Date;
  lastSeenAt: Date;
  absoluteExpiresAt: Date;
}

export interface SessionStore {
  create(session: Omit<SessionRecord, 'id'>): Promise<SessionRecord>;
  findByTokenHash(tokenHash: string): Promise<SessionRecord | null>;

  // Moves the idle clock. modules/identity/src/authentication-service.ts throttles how often it is called.
  touch(id: string, lastSeenAt: Date): Promise<void>;
  delete(id: string): Promise<void>;
}

export interface BreakGlassRecord {
  passwordHash: string;
  consecutiveFailures: number;
  lockedUntil: Date | null;
}

// A failure as counted on the stored record: the record just before it and just after.
export interface BreakGlassFailure {
  before: BreakGlassRecord;
  after: BreakGlassRecord;
}

export type BreakGlassSuccess =
  { applied: true } | { applied: false; current: BreakGlassRecord | null };

/**
 * Holds at most one record, the single break-glass credential. `load` returns null until it is set.
 * Only `setPassword` writes the password hash. Sign-in bookkeeping goes through `recordFailure` and
 * `recordSuccess`, and each reads and changes the stored record in one step, so overlapping sign-ins
 * and a password change never undo one another.
 */
export interface BreakGlassStore {
  load(): Promise<BreakGlassRecord | null>;

  // Sets the password hash and clears the failure count and any lock, creating the record if there is
  // none. The `break-glass:set` tool and the in-memory seeding in apps/api/src/auth/auth.factory.ts call it.
  setPassword(passwordHash: string): Promise<void>;

  // Counts one failure on the stored record and applies the lockout policy to it:
  // modules/identity/src/domain/break-glass.ts. Returns null when there is no record.
  recordFailure(policy: LockoutPolicy, now: Date): Promise<BreakGlassFailure | null>;

  // Clears the failure count and any lock, only while the stored hash is still `verifiedHash` and the
  // record is not locked at `now`. Otherwise changes nothing and returns the stored record.
  recordSuccess(verifiedHash: string, now: Date): Promise<BreakGlassSuccess>;
}

export type AuditEventType =
  | 'login.succeeded'
  | 'login.failed'
  | 'login.directory-unreachable'
  | 'logout'
  | 'break-glass.succeeded'
  | 'break-glass.failed'
  | 'break-glass.locked-out'
  | 'break-glass.unprovisioned'
  | 'authorization.denied'
  | 'role.granted'
  | 'role.revoked';

export interface AuditEvent {
  type: AuditEventType;

  // Whose event it is: the stored username on a successful sign-in, with the normalised name typed in
  // `detail` when the two differ, the normalised name typed on a failed one, the signed-in user, or the
  // acting Admin on a role event.
  username: string;
  at: Date;
  userId?: string;
  sourceIp?: string;

  detail?: string;
}

export interface AuditSink {
  record(event: AuditEvent): Promise<void>;
}

export interface Alert {
  type: 'break-glass.used' | 'break-glass.locked-out';
  message: string;
  at: Date;
}

export interface AlertSink {
  raise(alert: Alert): Promise<void>;
}
