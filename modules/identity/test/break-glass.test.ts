// Tests the lockout arithmetic in modules/identity/src/domain/break-glass.ts.
import { describe, expect, it } from 'vitest';

import {
  isLockedOut,
  recordFailure,
  recordSuccess,
  type LockoutPolicy,
} from '../src/domain/break-glass';
import type { BreakGlassRecord } from '../src/ports';

const POLICY: LockoutPolicy = { maxFailures: 5, lockoutMs: 15 * 60 * 1000 };
const NOW = new Date('2026-07-29T08:00:00.000Z');

function record(overrides: Partial<BreakGlassRecord> = {}): BreakGlassRecord {
  return { passwordHash: 'hash', consecutiveFailures: 0, lockedUntil: null, ...overrides };
}

describe('isLockedOut', () => {
  it('is false when never locked', () => {
    expect(isLockedOut(record(), NOW)).toBe(false);
  });

  it('is true inside the window and false once it elapses', () => {
    const lockedUntil = new Date(NOW.getTime() + 1000);
    expect(isLockedOut(record({ lockedUntil }), NOW)).toBe(true);
    expect(isLockedOut(record({ lockedUntil }), new Date(lockedUntil.getTime()))).toBe(false);
  });
});

describe('recordFailure', () => {
  it('counts up without locking below the threshold', () => {
    const after = recordFailure(record({ consecutiveFailures: 3 }), POLICY, NOW);
    expect(after.consecutiveFailures).toBe(4);
    expect(after.lockedUntil).toBeNull();
  });

  it('locks for a fixed window on the threshold failure', () => {
    const after = recordFailure(record({ consecutiveFailures: 4 }), POLICY, NOW);
    expect(after.consecutiveFailures).toBe(5);
    expect(after.lockedUntil).toEqual(new Date(NOW.getTime() + POLICY.lockoutMs));
  });

  it('keeps the window fixed rather than escalating — an emergency credential must stay predictably available', () => {
    const first = recordFailure(record({ consecutiveFailures: 4 }), POLICY, NOW);
    const later = new Date(NOW.getTime() + POLICY.lockoutMs);
    const second = recordFailure(first, POLICY, later);
    expect(second.lockedUntil).toEqual(new Date(later.getTime() + POLICY.lockoutMs));
  });

  it('never shortens a lock already in place', () => {
    const lockedUntil = new Date(NOW.getTime() + POLICY.lockoutMs);
    const earlier = new Date(NOW.getTime() - 30_000);
    const after = recordFailure(record({ consecutiveFailures: 5, lockedUntil }), POLICY, earlier);
    expect(after.consecutiveFailures).toBe(6);
    expect(after.lockedUntil).toEqual(lockedUntil);
  });

  it('preserves the stored hash', () => {
    expect(recordFailure(record(), POLICY, NOW).passwordHash).toBe('hash');
  });
});

describe('recordSuccess', () => {
  it('clears the counter and any lock', () => {
    const after = recordSuccess(
      record({ consecutiveFailures: 4, lockedUntil: new Date(NOW.getTime() + 1000) }),
    );
    expect(after.consecutiveFailures).toBe(0);
    expect(after.lockedUntil).toBeNull();
    expect(after.passwordHash).toBe('hash');
  });
});
