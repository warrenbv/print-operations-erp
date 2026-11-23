// The `BreakGlassStore` in PostgreSQL. The credential is one row under a fixed key. `setPassword`
// upserts on that key. The two sign-in operations each run in one transaction that locks the row
// before reading it, and neither writes `password_hash`.
import { eq, sql } from 'drizzle-orm';

import {
  isLockedOut,
  recordFailure as countFailure,
  type LockoutPolicy,
} from '../../domain/break-glass';
import type { IdentityDb } from '../../data/identity-db';
import { BREAK_GLASS_SINGLETON, breakGlass } from '../../data/schema';
import type {
  BreakGlassFailure,
  BreakGlassRecord,
  BreakGlassStore,
  BreakGlassSuccess,
} from '../../ports';

type BreakGlassRow = typeof breakGlass.$inferSelect;

function toRecord(row: BreakGlassRow): BreakGlassRecord {
  return {
    passwordHash: row.passwordHash,
    consecutiveFailures: row.consecutiveFailures,
    lockedUntil: row.lockedUntil,
  };
}

export class DrizzleBreakGlassStore implements BreakGlassStore {
  readonly #db: IdentityDb;

  constructor(db: IdentityDb) {
    this.#db = db;
  }

  async load(): Promise<BreakGlassRecord | null> {
    const [row] = await this.#db.select().from(breakGlass).limit(1);
    return row === undefined ? null : toRecord(row);
  }

  async setPassword(passwordHash: string): Promise<void> {
    await this.#db
      .insert(breakGlass)
      .values({
        singleton: BREAK_GLASS_SINGLETON,
        passwordHash,
        consecutiveFailures: 0,
        lockedUntil: null,
      })
      .onConflictDoUpdate({
        target: breakGlass.singleton,
        set: {
          passwordHash,
          consecutiveFailures: 0,
          lockedUntil: null,
          updatedAt: sql`now()`,
        },
      });
  }

  async recordFailure(policy: LockoutPolicy, now: Date): Promise<BreakGlassFailure | null> {
    return this.#db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(breakGlass)
        .where(eq(breakGlass.singleton, BREAK_GLASS_SINGLETON))
        .for('update');
      if (row === undefined) {
        return null;
      }
      const before = toRecord(row);
      const after = countFailure(before, policy, now);
      await tx
        .update(breakGlass)
        .set({
          consecutiveFailures: after.consecutiveFailures,
          lockedUntil: after.lockedUntil,
          updatedAt: sql`now()`,
        })
        .where(eq(breakGlass.singleton, BREAK_GLASS_SINGLETON));
      return { before, after };
    });
  }

  async recordSuccess(verifiedHash: string, now: Date): Promise<BreakGlassSuccess> {
    return this.#db.transaction(async (tx): Promise<BreakGlassSuccess> => {
      const [row] = await tx
        .select()
        .from(breakGlass)
        .where(eq(breakGlass.singleton, BREAK_GLASS_SINGLETON))
        .for('update');
      const current = row === undefined ? null : toRecord(row);
      if (current === null || current.passwordHash !== verifiedHash || isLockedOut(current, now)) {
        return { applied: false, current };
      }
      await tx
        .update(breakGlass)
        .set({ consecutiveFailures: 0, lockedUntil: null, updatedAt: sql`now()` })
        .where(eq(breakGlass.singleton, BREAK_GLASS_SINGLETON));
      return { applied: true };
    });
  }
}
