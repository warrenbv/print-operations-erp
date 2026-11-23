// The `BreakGlassStore` in memory. apps/api/src/auth/auth.factory.ts seeds it from
// `BREAK_GLASS_DEV_PASSWORD` when that is set, and otherwise it starts empty. Each operation reads and
// changes the record with no `await` in between, which is what makes it one step here.
import {
  isLockedOut,
  recordFailure as countFailure,
  recordSuccess as clearFailures,
  type LockoutPolicy,
} from '../../domain/break-glass';
import type {
  BreakGlassFailure,
  BreakGlassRecord,
  BreakGlassStore,
  BreakGlassSuccess,
} from '../../ports';

export class InMemoryBreakGlassStore implements BreakGlassStore {
  #record: BreakGlassRecord | null;

  constructor(record: BreakGlassRecord | null = null) {
    this.#record = record;
  }

  async load(): Promise<BreakGlassRecord | null> {
    return this.#record;
  }

  async setPassword(passwordHash: string): Promise<void> {
    this.#record = { passwordHash, consecutiveFailures: 0, lockedUntil: null };
  }

  async recordFailure(policy: LockoutPolicy, now: Date): Promise<BreakGlassFailure | null> {
    const before = this.#record;
    if (before === null) {
      return null;
    }
    const after = countFailure(before, policy, now);
    this.#record = after;
    return { before, after };
  }

  async recordSuccess(verifiedHash: string, now: Date): Promise<BreakGlassSuccess> {
    const current = this.#record;
    if (current === null || current.passwordHash !== verifiedHash || isLockedOut(current, now)) {
      return { applied: false, current };
    }
    this.#record = clearFailures(current);
    return { applied: true };
  }
}
