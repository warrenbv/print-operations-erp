// Session tokens and expiry as pure functions: docs/decisions/005-server-side-sessions.md.
// The stores that hold the hashed records: modules/identity/src/adapters/.
import { createHash, randomBytes } from 'node:crypto';

import type { SessionRecord } from '../ports';

const TOKEN_BYTES = 32;

export interface SessionPolicy {
  // Refreshed by use.
  idleTimeoutMs: number;

  // Counted from issue and never refreshed.
  absoluteLifetimeMs: number;
}

export const DEFAULT_SESSION_POLICY: SessionPolicy = {
  idleTimeoutMs: 8 * 60 * 60 * 1000,
  absoluteLifetimeMs: 12 * 60 * 60 * 1000,
};

export function generateSessionToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

// A fast hash is right here because the token is high-entropy and random. A database dump yields no
// usable sessions: docs/decisions/005-server-side-sessions.md.
export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** The earlier of the idle deadline and the absolute deadline. */
export function sessionExpiresAt(session: SessionRecord, policy: SessionPolicy): Date {
  const idleDeadline = session.lastSeenAt.getTime() + policy.idleTimeoutMs;
  return new Date(Math.min(idleDeadline, session.absoluteExpiresAt.getTime()));
}

export function isSessionExpired(
  session: SessionRecord,
  policy: SessionPolicy,
  now: Date,
): boolean {
  return now.getTime() >= sessionExpiresAt(session, policy).getTime();
}
