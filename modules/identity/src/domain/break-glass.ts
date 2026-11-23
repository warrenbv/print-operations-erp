// The break-glass lockout as pure functions. The `BreakGlassStore` adapters apply them to the stored
// record as they change it, and modules/identity/src/authentication-service.ts reads the result.
import type { BreakGlassRecord } from '../ports';

export interface LockoutPolicy {
  maxFailures: number;
  lockoutMs: number;
}

export const DEFAULT_LOCKOUT_POLICY: LockoutPolicy = {
  maxFailures: 5,
  lockoutMs: 15 * 60 * 1000,
};

export function isLockedOut(record: BreakGlassRecord, now: Date): boolean {
  return record.lockedUntil !== null && now.getTime() < record.lockedUntil.getTime();
}

/**
 * Counts one more failure and locks for `lockoutMs` once the count reaches `maxFailures`. The count is
 * not reset when a lock expires, only by `recordSuccess`. So after a lock ends, the next wrong password
 * locks again at once. A lock already in place is never shortened, which matters when a failure that
 * started earlier is counted after the one that locked.
 */
export function recordFailure(
  record: BreakGlassRecord,
  policy: LockoutPolicy,
  now: Date,
): BreakGlassRecord {
  const consecutiveFailures = record.consecutiveFailures + 1;
  if (consecutiveFailures < policy.maxFailures) {
    return {
      passwordHash: record.passwordHash,
      consecutiveFailures,
      lockedUntil: record.lockedUntil,
    };
  }
  const lockEnd = new Date(now.getTime() + policy.lockoutMs);
  return {
    passwordHash: record.passwordHash,
    consecutiveFailures,
    lockedUntil:
      record.lockedUntil !== null && record.lockedUntil.getTime() > lockEnd.getTime()
        ? record.lockedUntil
        : lockEnd,
  };
}

export function recordSuccess(record: BreakGlassRecord): BreakGlassRecord {
  return { passwordHash: record.passwordHash, consecutiveFailures: 0, lockedUntil: null };
}
