// The contract for `BreakGlassStore` in modules/identity/src/ports.ts, driven through
// `AuthenticationService` sign-in. One set of assertions, run against the in-memory and the Drizzle
// adapter by modules/identity/test/break-glass-contracts.test.ts. Sign-in bookkeeping never writes the
// password hash, overlapping failures all count, and a sign-in verified against a hash that has since
// been replaced, or while overlapping failures locked the account, does not succeed. A hasher that
// holds each verification until the test releases it makes every overlap deterministic. A failure
// means one adapter breaks a promise the other keeps: docs/process/verifying-agent-written-code.md.
import { beforeEach, describe, expect, it } from 'vitest';

import { InMemorySessionStore } from '../../src/adapters/in-memory/in-memory-session-store';
import { InMemoryUserRepository } from '../../src/adapters/in-memory/in-memory-user-repository';
import { AuthenticationService, type LoginOutcome } from '../../src/authentication-service';
import type { LockoutPolicy } from '../../src/domain/break-glass';
import type {
  Alert,
  AuditEvent,
  BreakGlassStore,
  Clock,
  PasswordHasher,
  SessionRecord,
} from '../../src/ports';

const START = new Date('2026-09-14T07:30:00.000Z');
const POLICY: LockoutPolicy = { maxFailures: 3, lockoutMs: 10 * 60 * 1000 };
const USERNAME = 'break-glass';
const FIRST_PASSWORD = 'first-vault-phrase-example';
const SECOND_PASSWORD = 'second-vault-phrase-example';

class MutableClock implements Clock {
  #current = START;
  now(): Date {
    return this.#current;
  }
  advance(ms: number): void {
    this.#current = new Date(this.#current.getTime() + ms);
  }
}

// Verifies like a plain comparison. While `holding` is true each verification waits until the test
// releases it, so the test decides what lands between a sign-in's read and its write.
class GatedHasher implements PasswordHasher {
  holding = false;
  readonly #held: Array<() => void> = [];
  readonly #waiters: Array<{ count: number; resolve: () => void }> = [];

  async hash(plaintext: string): Promise<string> {
    return `gated:${plaintext}`;
  }

  async verify(hash: string, plaintext: string): Promise<boolean> {
    if (this.holding) {
      await new Promise<void>((resolve) => {
        this.#held.push(resolve);
        for (const waiter of this.#waiters.filter((w) => this.#held.length >= w.count)) {
          waiter.resolve();
        }
      });
    }
    return hash === `gated:${plaintext}`;
  }

  // Resolves once `count` verifications are waiting.
  untilHeld(count: number): Promise<void> {
    if (this.#held.length >= count) {
      return Promise.resolve();
    }
    return new Promise((resolve) => this.#waiters.push({ count, resolve }));
  }

  // Lets the waiting verification at `index`, in order of arrival, finish.
  release(index: number): void {
    const resolve = this.#held[index];
    if (resolve === undefined) {
      throw new Error(`no verification is held at ${index}`);
    }
    resolve();
  }
}

class CountingSessionStore extends InMemorySessionStore {
  created = 0;
  override async create(session: Omit<SessionRecord, 'id'>): Promise<SessionRecord> {
    this.created += 1;
    return super.create(session);
  }
}

export function breakGlassStoreContract(makeStore: () => Promise<BreakGlassStore>): void {
  let store: BreakGlassStore;
  let hasher: GatedHasher;
  let clock: MutableClock;
  let sessions: CountingSessionStore;
  let audit: AuditEvent[];
  let alerts: Alert[];
  let service: AuthenticationService;

  async function setPassword(password: string): Promise<void> {
    await store.setPassword(await hasher.hash(password));
  }

  function login(password: string): Promise<LoginOutcome> {
    return service.login(USERNAME, password);
  }

  beforeEach(async () => {
    store = await makeStore();
    hasher = new GatedHasher();
    clock = new MutableClock();
    sessions = new CountingSessionStore();
    audit = [];
    alerts = [];
    service = new AuthenticationService({
      provider: { authenticate: async () => ({ ok: false, reason: 'invalid-credentials' }) },
      users: new InMemoryUserRepository(),
      sessions,
      breakGlass: store,
      hasher,
      audit: { record: async (event) => void audit.push(event) },
      alerts: { raise: async (alert) => void alerts.push(alert) },
      clock,
      breakGlassUsername: USERNAME,
      lockoutPolicy: POLICY,
    });
    await setPassword(FIRST_PASSWORD);
  });

  describe('store operations', () => {
    it('recordSuccess for a hash that is no longer stored changes nothing', async () => {
      await store.recordFailure(POLICY, START);

      const outcome = await store.recordSuccess('gated:some-earlier-phrase', START);

      const stored = {
        passwordHash: 'gated:first-vault-phrase-example',
        consecutiveFailures: 1,
        lockedUntil: null,
      };
      expect(outcome).toEqual({ applied: false, current: stored });
      expect(await store.load()).toEqual(stored);
    });

    it('recordFailure returns the record before and after, with the hash untouched', async () => {
      const counted = await store.recordFailure(POLICY, START);

      expect(counted).toEqual({
        before: {
          passwordHash: 'gated:first-vault-phrase-example',
          consecutiveFailures: 0,
          lockedUntil: null,
        },
        after: {
          passwordHash: 'gated:first-vault-phrase-example',
          consecutiveFailures: 1,
          lockedUntil: null,
        },
      });
    });
  });

  describe('one sign-in at a time', () => {
    it('admits the right password and clears the failure count', async () => {
      await login('not-it');
      await login('not-it-either');
      expect((await store.load())?.consecutiveFailures).toBe(2);

      const outcome = await login(FIRST_PASSWORD);

      expect(outcome.ok).toBe(true);
      expect(sessions.created).toBe(1);
      expect(await store.load()).toEqual({
        passwordHash: 'gated:first-vault-phrase-example',
        consecutiveFailures: 0,
        lockedUntil: null,
      });
    });

    it('counts a wrong password and leaves the password alone', async () => {
      const outcome = await login('not-it');

      expect(outcome).toEqual({ ok: false, reason: 'invalid-credentials' });
      expect(await store.load()).toEqual({
        passwordHash: 'gated:first-vault-phrase-example',
        consecutiveFailures: 1,
        lockedUntil: null,
      });
      expect(audit.map((event) => [event.type, event.detail])).toEqual([
        ['break-glass.failed', 'consecutive failures: 1'],
      ]);
    });

    it('locks at the policy count, alerts once, and refuses the right password without counting it', async () => {
      for (let i = 0; i < POLICY.maxFailures; i += 1) {
        await login('not-it');
      }
      const lockedUntil = new Date(START.getTime() + POLICY.lockoutMs);
      expect((await store.load())?.lockedUntil?.getTime()).toBe(lockedUntil.getTime());

      const outcome = await login(FIRST_PASSWORD);

      expect(outcome).toEqual({ ok: false, reason: 'invalid-credentials' });
      expect(sessions.created).toBe(0);
      expect((await store.load())?.consecutiveFailures).toBe(POLICY.maxFailures);
      expect(alerts.map((alert) => alert.type)).toEqual(['break-glass.locked-out']);
      expect(audit.at(-1)?.type).toBe('break-glass.locked-out');
      expect(audit.at(-1)?.detail).toBe(`locked until ${lockedUntil.toISOString()}`);
    });

    it('admits the right password once the lock has passed', async () => {
      for (let i = 0; i < POLICY.maxFailures; i += 1) {
        await login('not-it');
      }
      clock.advance(POLICY.lockoutMs);

      expect((await login(FIRST_PASSWORD)).ok).toBe(true);
      expect((await store.load())?.consecutiveFailures).toBe(0);
    });

    it('setting the password clears the failure count and the lock', async () => {
      for (let i = 0; i < POLICY.maxFailures; i += 1) {
        await login('not-it');
      }

      await setPassword(SECOND_PASSWORD);

      expect(await store.load()).toEqual({
        passwordHash: 'gated:second-vault-phrase-example',
        consecutiveFailures: 0,
        lockedUntil: null,
      });
      expect((await login(SECOND_PASSWORD)).ok).toBe(true);
    });
  });

  describe('sign-ins that overlap', () => {
    it('keeps a password set while a failed sign-in was verifying', async () => {
      hasher.holding = true;
      const pending = login('not-it');
      await hasher.untilHeld(1);

      await setPassword(SECOND_PASSWORD);
      hasher.release(0);

      expect(await pending).toEqual({ ok: false, reason: 'invalid-credentials' });
      expect((await store.load())?.passwordHash).toBe('gated:second-vault-phrase-example');

      hasher.holding = false;
      expect((await login(SECOND_PASSWORD)).ok).toBe(true);
    });

    it('refuses a sign-in whose password was replaced while it was verifying, and keeps the new one', async () => {
      hasher.holding = true;
      const pending = login(FIRST_PASSWORD);
      await hasher.untilHeld(1);

      await setPassword(SECOND_PASSWORD);
      hasher.release(0);

      expect(await pending).toEqual({ ok: false, reason: 'invalid-credentials' });
      expect(sessions.created).toBe(0);
      expect(alerts).toEqual([]);
      expect(audit.map((event) => event.type)).toEqual(['break-glass.failed']);
      expect((await store.load())?.passwordHash).toBe('gated:second-vault-phrase-example');

      hasher.holding = false;
      expect(await login(FIRST_PASSWORD)).toEqual({ ok: false, reason: 'invalid-credentials' });
      expect((await login(SECOND_PASSWORD)).ok).toBe(true);
    });

    it('counts two overlapping failures as two', async () => {
      hasher.holding = true;
      const first = login('not-it');
      const second = login('not-it-either');
      await hasher.untilHeld(2);

      hasher.release(0);
      hasher.release(1);
      await Promise.all([first, second]);

      expect((await store.load())?.consecutiveFailures).toBe(2);
      expect(audit.map((event) => event.detail).sort()).toEqual([
        'consecutive failures: 1',
        'consecutive failures: 2',
      ]);
    });

    it('locks at the policy count when the failures overlap, and alerts once', async () => {
      await login('not-it');

      hasher.holding = true;
      const first = login('not-it-either');
      const second = login('still-not-it');
      await hasher.untilHeld(2);
      hasher.release(0);
      hasher.release(1);
      await Promise.all([first, second]);

      const record = await store.load();
      expect(record?.consecutiveFailures).toBe(POLICY.maxFailures);
      expect(record?.lockedUntil?.getTime()).toBe(START.getTime() + POLICY.lockoutMs);
      expect(alerts.map((alert) => alert.type)).toEqual(['break-glass.locked-out']);

      hasher.holding = false;
      expect(await login(FIRST_PASSWORD)).toEqual({ ok: false, reason: 'invalid-credentials' });
      expect(sessions.created).toBe(0);
    });

    it('refuses a right password whose verification overlapped the failures that locked the account', async () => {
      hasher.holding = true;
      const pending = login(FIRST_PASSWORD);
      await hasher.untilHeld(1);

      hasher.holding = false;
      for (let i = 0; i < POLICY.maxFailures; i += 1) {
        await login('not-it');
      }
      hasher.release(0);

      expect(await pending).toEqual({ ok: false, reason: 'invalid-credentials' });
      expect(sessions.created).toBe(0);
      expect(audit.at(-1)?.type).toBe('break-glass.locked-out');
      expect(alerts.map((alert) => alert.type)).toEqual(['break-glass.locked-out']);
      const record = await store.load();
      expect(record?.consecutiveFailures).toBe(POLICY.maxFailures);
      expect(record?.lockedUntil?.getTime()).toBe(START.getTime() + POLICY.lockoutMs);
    });

    it('a failure that started before the locking one neither shortens the lock nor alerts again', async () => {
      await login('not-it');
      await login('not-it-either');

      hasher.holding = true;
      const earlier = login('still-not-it');
      await hasher.untilHeld(1);
      clock.advance(60_000);
      const later = login('nor-this');
      await hasher.untilHeld(2);

      hasher.release(1);
      await later;
      const lockedUntil = START.getTime() + 60_000 + POLICY.lockoutMs;
      expect((await store.load())?.lockedUntil?.getTime()).toBe(lockedUntil);

      hasher.release(0);
      await earlier;

      const record = await store.load();
      expect(record?.consecutiveFailures).toBe(POLICY.maxFailures + 1);
      expect(record?.lockedUntil?.getTime()).toBe(lockedUntil);
      expect(alerts.map((alert) => alert.type)).toEqual(['break-glass.locked-out']);
    });
  });
}
