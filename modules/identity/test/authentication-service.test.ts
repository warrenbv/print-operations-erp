// Tests modules/identity/src/authentication-service.ts on the in-memory stores with a clock the test
// moves: sign-in, session expiry, sign-out, lockout and alerting for the break-glass account, and refusal
// auditing.
// The rules: docs/decisions/005-server-side-sessions.md.
import type { AuthProvider, AuthResult } from '@erp/types';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  AuthenticationService,
  BREAK_GLASS_EXTERNAL_ID,
  BREAK_GLASS_ROLE,
} from '../src/authentication-service';
import { InMemoryBreakGlassStore } from '../src/adapters/in-memory/in-memory-break-glass-store';
import { InMemorySessionStore } from '../src/adapters/in-memory/in-memory-session-store';
import { InMemoryUserRepository } from '../src/adapters/in-memory/in-memory-user-repository';
import { LocalAuthProvider } from '../src/providers/local-auth-provider';
import type {
  Alert,
  AlertSink,
  AuditEvent,
  AuditSink,
  BreakGlassRecord,
  Clock,
  PasswordHasher,
} from '../src/ports';

const START = new Date('2026-07-29T08:00:00.000Z');
const DEV_PASSWORD = 'dev-password';
const BREAK_GLASS_PASSWORD = 'sealed-emergency-password';

class MutableClock implements Clock {
  #current = START;
  now(): Date {
    return this.#current;
  }
  advance(ms: number): void {
    this.#current = new Date(this.#current.getTime() + ms);
  }
}

const fakeHasher: PasswordHasher = {
  hash: async (plaintext) => `fake:${plaintext}`,
  verify: async (hash, plaintext) => hash === `fake:${plaintext}`,
};

class RecordingAuditSink implements AuditSink {
  readonly events: AuditEvent[] = [];
  async record(event: AuditEvent): Promise<void> {
    this.events.push(event);
  }
  get types(): string[] {
    return this.events.map((event) => event.type);
  }
}

class RecordingAlertSink implements AlertSink {
  readonly alerts: Alert[] = [];
  async raise(alert: Alert): Promise<void> {
    this.alerts.push(alert);
  }
  get types(): string[] {
    return this.alerts.map((alert) => alert.type);
  }
}

class CountingProvider implements AuthProvider {
  calls = 0;
  constructor(private readonly inner: AuthProvider) {}
  async authenticate(username: string, password: string): Promise<AuthResult> {
    this.calls += 1;
    return this.inner.authenticate(username, password);
  }
}

const unreachableProvider: AuthProvider = {
  authenticate: async () => ({ ok: false, reason: 'directory-unreachable' }),
};

interface Harness {
  service: AuthenticationService;
  clock: MutableClock;
  audit: RecordingAuditSink;
  alerts: RecordingAlertSink;
  sessions: InMemorySessionStore;
  users: InMemoryUserRepository;
  provider: CountingProvider;
}

function harness(
  options: { breakGlass?: BreakGlassRecord | null; provider?: AuthProvider } = {},
): Harness {
  const clock = new MutableClock();
  const audit = new RecordingAuditSink();
  const alerts = new RecordingAlertSink();
  const sessions = new InMemorySessionStore();
  const users = new InMemoryUserRepository();
  const provider = new CountingProvider(options.provider ?? new LocalAuthProvider(DEV_PASSWORD));
  const service = new AuthenticationService({
    provider,
    users,
    sessions,
    breakGlass: new InMemoryBreakGlassStore(options.breakGlass ?? null),
    hasher: fakeHasher,
    audit,
    alerts,
    clock,
    breakGlassUsername: 'break-glass',
    sessionPolicy: { idleTimeoutMs: 60 * 60 * 1000, absoluteLifetimeMs: 4 * 60 * 60 * 1000 },
    lockoutPolicy: { maxFailures: 5, lockoutMs: 15 * 60 * 1000 },
  });
  return { service, clock, audit, alerts, sessions, users, provider };
}

function provisionedBreakGlass(): BreakGlassRecord {
  return {
    passwordHash: `fake:${BREAK_GLASS_PASSWORD}`,
    consecutiveFailures: 0,
    lockedUntil: null,
  };
}

describe('login — ordinary users', () => {
  let h: Harness;
  beforeEach(() => {
    h = harness();
  });

  it('issues a session for correct credentials', async () => {
    const outcome = await h.service.login('dev-sales', DEV_PASSWORD);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.user.username).toBe('dev-sales');
    expect(outcome.token).toHaveLength(43);
    expect(h.audit.types).toEqual(['login.succeeded']);
  });

  it('normalizes the submitted username', async () => {
    const outcome = await h.service.login('  DEV-Sales ', DEV_PASSWORD);
    expect(outcome.ok).toBe(true);
  });

  it.each([
    ['a wrong password', 'dev-sales', 'nope'],
    ['an unknown user', 'nobody', DEV_PASSWORD],
  ])('rejects %s with the uniform failure', async (_label, username, password) => {
    const outcome = await h.service.login(username, password);
    expect(outcome).toEqual({ ok: false, reason: 'invalid-credentials' });
    expect(h.audit.types).toEqual(['login.failed']);
  });

  it('passes directory-unreachable through, distinguishable from bad credentials', async () => {
    const unreachable = harness({ provider: unreachableProvider });
    const outcome = await unreachable.service.login('dev-sales', DEV_PASSWORD);
    expect(outcome).toEqual({ ok: false, reason: 'directory-unreachable' });
    expect(unreachable.audit.types).toEqual(['login.directory-unreachable']);
  });

  it('creates the user with zero roles on first login and preserves roles on the next', async () => {
    const first = await h.service.login('dev-sales', DEV_PASSWORD);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.user.roles).toEqual([]);

    await h.users.upsertFromIdentity({
      externalId: first.user.externalId,
      username: 'dev-sales',
      displayName: 'dev-sales',
    });
    const stored = await h.users.findById(first.user.id);
    expect(stored?.roles).toEqual([]);

    const second = await h.service.login('dev-sales', DEV_PASSWORD);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.user.id).toBe(first.user.id);
  });

  it('records the source IP on the audit event when supplied', async () => {
    await h.service.login('dev-sales', DEV_PASSWORD, { sourceIp: '192.0.2.4' });
    expect(h.audit.events.map((event) => event.sourceIp)).toEqual(['192.0.2.4']);
  });

  it('never puts the password on an audit event', async () => {
    await h.service.login('dev-sales', 'hunter2-wrong');
    expect(JSON.stringify(h.audit.events)).not.toContain('hunter2-wrong');
  });

  it('audits a sign-in under the typed name when it is the stored name, with no detail', async () => {
    await h.service.login('  DEV-Sales ', DEV_PASSWORD);
    const [event] = h.audit.events;
    expect(event?.type).toBe('login.succeeded');
    expect(event?.username).toBe('dev-sales');
    expect(event).not.toHaveProperty('detail');
  });
});

// A provider that verifies any password and answers one fixed identity, as a directory does for a principal name.
function identityProvider(identity: {
  externalId: string;
  username: string;
  displayName: string;
}): AuthProvider {
  return { authenticate: async () => ({ ok: true, identity }) };
}

describe('login — the stored name differs from the typed one', () => {
  it('audits the sign-in under the stored username, with the typed name in the detail', async () => {
    const h = harness({
      provider: identityProvider({
        externalId: 'guid-plate-maker',
        username: 'plate.maker',
        displayName: 'Plate Maker',
      }),
    });

    const outcome = await h.service.login(' Plate.Maker@Example.test ', 'directory-password');

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(h.audit.events).toEqual([
      {
        type: 'login.succeeded',
        username: 'plate.maker',
        at: START,
        userId: outcome.user.id,
        detail: 'typed=plate.maker@example.test',
      },
    ]);
  });

  it.each([
    ['the reserved name', 'break-glass'],
    ['the reserved name in other case', ' Break-Glass '],
  ])(
    'refuses a directory account whose account name is %s, audits it as failed and stores nothing',
    async (_label, accountName) => {
      const h = harness({
        breakGlass: provisionedBreakGlass(),
        provider: identityProvider({
          externalId: 'guid-name-squatter',
          username: accountName,
          displayName: 'Name Squatter',
        }),
      });

      const outcome = await h.service.login('name.squatter@example.test', 'directory-password');

      expect(outcome).toEqual({ ok: false, reason: 'invalid-credentials' });
      expect(h.audit.events.map((event) => [event.type, event.username])).toEqual([
        ['login.failed', 'name.squatter@example.test'],
      ]);
      expect(h.audit.events[0]).not.toHaveProperty('userId');
      expect(h.audit.events[0]?.detail).toBe(
        'refused: the directory identity carries the break-glass name or id externalId=guid-name-squatter',
      );
      expect(await h.users.findByExternalId('guid-name-squatter')).toBeNull();
      expect(await h.users.findByUsername('break-glass')).toBeNull();
      expect(h.alerts.alerts).toEqual([]);
    },
  );

  it('refuses a directory identity that carries the break-glass external id, and stores nothing', async () => {
    const h = harness({
      breakGlass: provisionedBreakGlass(),
      provider: identityProvider({
        externalId: BREAK_GLASS_EXTERNAL_ID,
        username: 'id.squatter',
        displayName: 'Id Squatter',
      }),
    });

    const outcome = await h.service.login('id.squatter', 'directory-password');

    expect(outcome).toEqual({ ok: false, reason: 'invalid-credentials' });
    expect(h.audit.types).toEqual(['login.failed']);
    expect(h.audit.events[0]?.detail).toBe(
      `refused: the directory identity carries the break-glass name or id externalId=${BREAK_GLASS_EXTERNAL_ID}`,
    );
    expect(await h.users.findByExternalId(BREAK_GLASS_EXTERNAL_ID)).toBeNull();
  });
});

describe('session resolution', () => {
  it('resolves a live session to its user', async () => {
    const h = harness();
    const outcome = await h.service.login('dev-sales', DEV_PASSWORD);
    if (!outcome.ok) throw new Error('login failed');

    const resolved = await h.service.resolveSession(outcome.token);
    expect(resolved?.user.id).toBe(outcome.user.id);
  });

  it.each([
    ['an unknown token', 'not-a-real-token'],
    ['an empty token', ''],
  ])('returns null for %s', async (_label, token) => {
    const h = harness();
    expect(await h.service.resolveSession(token)).toBeNull();
  });

  it('expires an idle session and drops the row', async () => {
    const h = harness();
    const outcome = await h.service.login('dev-sales', DEV_PASSWORD);
    if (!outcome.ok) throw new Error('login failed');

    h.clock.advance(60 * 60 * 1000);
    expect(await h.service.resolveSession(outcome.token)).toBeNull();

    expect(await h.sessions.findByTokenHash(outcome.token)).toBeNull();
  });

  it('keeps an actively-used session alive past the idle window', async () => {
    const h = harness();
    const outcome = await h.service.login('dev-sales', DEV_PASSWORD);
    if (!outcome.ok) throw new Error('login failed');

    for (let i = 0; i < 4; i += 1) {
      h.clock.advance(50 * 60 * 1000);
      expect(await h.service.resolveSession(outcome.token)).not.toBeNull();
    }
  });

  it('expires at the absolute ceiling despite continuous use', async () => {
    const h = harness();
    const outcome = await h.service.login('dev-sales', DEV_PASSWORD);
    if (!outcome.ok) throw new Error('login failed');

    for (let i = 0; i < 4; i += 1) {
      h.clock.advance(50 * 60 * 1000);
      await h.service.resolveSession(outcome.token);
    }
    h.clock.advance(60 * 60 * 1000);
    expect(await h.service.resolveSession(outcome.token)).toBeNull();
  });

  it('invalidates the session when the user disappears', async () => {
    const h = harness();
    const outcome = await h.service.login('dev-sales', DEV_PASSWORD);
    if (!outcome.ok) throw new Error('login failed');

    const empty = new InMemoryUserRepository();
    const detached = new AuthenticationService({
      provider: new LocalAuthProvider(DEV_PASSWORD),
      users: empty,
      sessions: h.sessions,
      breakGlass: new InMemoryBreakGlassStore(null),
      hasher: fakeHasher,
      audit: h.audit,
      alerts: h.alerts,
      clock: h.clock,
      breakGlassUsername: 'break-glass',
    });
    expect(await detached.resolveSession(outcome.token)).toBeNull();
  });
});

describe('logout', () => {
  it('ends the session', async () => {
    const h = harness();
    const outcome = await h.service.login('dev-sales', DEV_PASSWORD);
    if (!outcome.ok) throw new Error('login failed');

    await h.service.logout(outcome.token);
    expect(await h.service.resolveSession(outcome.token)).toBeNull();
    expect(h.audit.types).toEqual(['login.succeeded', 'logout']);
  });

  it('is silent for an unknown token', async () => {
    const h = harness();
    await expect(h.service.logout('nope')).resolves.toBeUndefined();
  });
});

describe('break-glass', () => {
  it('resolves before the provider is ever consulted', async () => {
    const h = harness({ breakGlass: provisionedBreakGlass() });
    await h.service.login('break-glass', BREAK_GLASS_PASSWORD);
    expect(h.provider.calls).toBe(0);
  });

  it('works while the directory is unreachable — the whole point', async () => {
    const h = harness({
      breakGlass: provisionedBreakGlass(),
      provider: unreachableProvider,
    });
    const outcome = await h.service.login('break-glass', BREAK_GLASS_PASSWORD);
    expect(outcome.ok).toBe(true);
  });

  it('carries the Admin role implicitly without storing it', async () => {
    const h = harness({ breakGlass: provisionedBreakGlass() });
    const outcome = await h.service.login('break-glass', BREAK_GLASS_PASSWORD);
    if (!outcome.ok) throw new Error('login failed');

    expect(outcome.user.roles).toEqual([BREAK_GLASS_ROLE]);
    expect(outcome.user.externalId).toBe(BREAK_GLASS_EXTERNAL_ID);

    const stored = await h.users.findById(outcome.user.id);
    expect(stored?.roles).toEqual([]);

    const resolved = await h.service.resolveSession(outcome.token);
    expect(resolved?.user.roles).toEqual([BREAK_GLASS_ROLE]);
  });

  it('alerts the owner on every successful use', async () => {
    const h = harness({ breakGlass: provisionedBreakGlass() });
    await h.service.login('break-glass', BREAK_GLASS_PASSWORD, { sourceIp: '192.0.2.4' });
    expect(h.alerts.types).toEqual(['break-glass.used']);
    expect(h.alerts.alerts.map((alert) => alert.message).join()).toContain('192.0.2.4');
    expect(h.audit.types).toEqual(['break-glass.succeeded']);
  });

  it('rejects an unprovisioned account with the uniform failure', async () => {
    const h = harness({ breakGlass: null });
    const outcome = await h.service.login('break-glass', BREAK_GLASS_PASSWORD);
    expect(outcome).toEqual({ ok: false, reason: 'invalid-credentials' });
    expect(h.audit.types).toEqual(['break-glass.unprovisioned']);
  });

  it('counts failures and locks on the fifth, alerting once', async () => {
    const h = harness({ breakGlass: provisionedBreakGlass() });
    for (let i = 0; i < 5; i += 1) {
      const outcome = await h.service.login('break-glass', 'wrong');
      expect(outcome).toEqual({ ok: false, reason: 'invalid-credentials' });
    }
    expect(h.audit.types).toEqual(Array.from({ length: 5 }, () => 'break-glass.failed'));
    expect(h.alerts.types).toEqual(['break-glass.locked-out']);
  });

  it('rejects even the correct password while locked, without revealing the lock', async () => {
    const h = harness({ breakGlass: provisionedBreakGlass() });
    for (let i = 0; i < 5; i += 1) {
      await h.service.login('break-glass', 'wrong');
    }
    const outcome = await h.service.login('break-glass', BREAK_GLASS_PASSWORD);
    expect(outcome).toEqual({ ok: false, reason: 'invalid-credentials' });
    expect(h.audit.types).toContain('break-glass.locked-out');
  });

  it('admits the correct password once the fixed window elapses', async () => {
    const h = harness({ breakGlass: provisionedBreakGlass() });
    for (let i = 0; i < 5; i += 1) {
      await h.service.login('break-glass', 'wrong');
    }
    h.clock.advance(15 * 60 * 1000);
    const outcome = await h.service.login('break-glass', BREAK_GLASS_PASSWORD);
    expect(outcome.ok).toBe(true);
  });

  it('clears the failure count on success so the next slip does not lock immediately', async () => {
    const h = harness({ breakGlass: provisionedBreakGlass() });
    for (let i = 0; i < 4; i += 1) {
      await h.service.login('break-glass', 'wrong');
    }
    await h.service.login('break-glass', BREAK_GLASS_PASSWORD);
    const outcome = await h.service.login('break-glass', 'wrong');
    expect(outcome).toEqual({ ok: false, reason: 'invalid-credentials' });

    expect(h.alerts.types).toEqual(['break-glass.used']);
  });

  it('matches the reserved username case-insensitively', async () => {
    const h = harness({ breakGlass: provisionedBreakGlass() });
    const outcome = await h.service.login('  Break-Glass  ', BREAK_GLASS_PASSWORD);
    expect(outcome.ok).toBe(true);
    expect(h.provider.calls).toBe(0);
  });
});

describe('recordAuthorizationDenied', () => {
  const user = {
    id: 'user-1',
    externalId: 'local:jdoe',
    username: 'jdoe',
    displayName: 'jdoe',
    roles: ['Sales'] as const,
  };

  it('names the roles when the route declared some', async () => {
    const h = harness();
    await h.service.recordAuthorizationDenied(user, 'POST /admin/users', ['Admin']);
    expect(h.audit.events[0]?.detail).toBe('route=POST /admin/users required=Admin held=Sales');
  });

  it('calls an empty list the fail-closed default, which is what it means', async () => {
    const h = harness();
    await h.service.recordAuthorizationDenied(user, 'GET /orders/new', []);
    expect(h.audit.events[0]?.detail).toContain('default-deny');
  });

  it('prints a cause instead, for a refusal that is about the caller', async () => {
    const h = harness();
    await h.service.recordAuthorizationDenied(user, 'POST /orders', [], {}, 'read-only account');
    expect(h.audit.events[0]?.detail).toBe('route=POST /orders refused: read-only account');
    expect(h.audit.events[0]?.detail).not.toContain('default-deny');
  });
});
