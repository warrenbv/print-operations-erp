// Runs the PostgreSQL user, session and break-glass stores against a migrated `identity` schema, and
// checks that a session issued by one service instance resolves in another. Skips without
// `DATABASE_URL`. `pnpm test:db` (scripts/test-db.mjs) supplies a throwaway Postgres. The user and
// session ports have no shared contract suite, so their in-memory adapters are covered by their own
// tests. The break-glass store's contract is in modules/identity/test/break-glass-contracts.test.ts.
import { resolve } from 'node:path';

import { moduleTestDatabase, type Pool } from '@erp/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { Argon2PasswordHasher } from '../src/adapters/argon2-password-hasher';
import { DrizzleBreakGlassStore } from '../src/adapters/drizzle/drizzle-break-glass-store';
import { DrizzleSessionStore } from '../src/adapters/drizzle/drizzle-session-store';
import { DrizzleUserRepository } from '../src/adapters/drizzle/drizzle-user-repository';
import { systemClock } from '../src/adapters/system-clock';
import { AuthenticationService } from '../src/authentication-service';
import { createIdentityDb, type IdentityDb } from '../src/data/identity-db';
import type { AlertSink, AuditSink, PasswordHasher } from '../src/ports';
import { LocalAuthProvider } from '../src/providers/local-auth-provider';

const IDENTITY_MIGRATIONS = resolve(__dirname, '../../../infra/db/migrations/identity');

const testDb = moduleTestDatabase({
  moduleName: 'identity',
  migrationsFolder: IDENTITY_MIGRATIONS,
  isolationKey: 'adapters',
});

const describeDb = testDb.enabled ? describe : describe.skip;

const DEV_PASSWORD = 'dev-password';

const silentAudit: AuditSink = { record: async () => undefined };
const silentAlerts: AlertSink = { raise: async () => undefined };

const fakeHasher: PasswordHasher = {
  hash: async (plaintext) => `hashed:${plaintext}`,
  verify: async (hash, plaintext) => hash === `hashed:${plaintext}`,
};

let pool: Pool;
let db: IdentityDb;

beforeAll(async () => {
  if (!testDb.enabled) return;
  await testDb.setup();
  pool = testDb.pool;
  db = createIdentityDb(pool);
}, 180_000);

afterAll(async () => {
  await testDb.teardown();
});

beforeEach(async () => {
  await testDb.truncate(['identity.sessions', 'identity.users', 'identity.break_glass']);
});

describeDb('DrizzleUserRepository', () => {
  it('provisions a user on first sight with no roles', async () => {
    const users = new DrizzleUserRepository(db);

    const user = await users.upsertFromIdentity({
      externalId: 'guid-1',
      username: 'jdoe',
      displayName: 'A Example',
      email: 'jdoe@example.test',
    });

    expect(user.roles).toEqual([]);
    expect(user.email).toBe('jdoe@example.test');
    expect(await users.findById(user.id)).toEqual(user);
  });

  it('refreshes directory-owned fields on a later login without disturbing roles', async () => {
    const users = new DrizzleUserRepository(db);
    const first = await users.upsertFromIdentity({
      externalId: 'guid-2',
      username: 'jdoe',
      displayName: 'A Example',
    });

    await pool.query(`update identity.users set roles = ARRAY['Admin'] where id = $1`, [first.id]);

    const second = await users.upsertFromIdentity({
      externalId: 'guid-2',
      username: 'jdoe2',
      displayName: 'Alex Example',
      email: 'jane@example.test',
    });

    expect(second.id).toBe(first.id);
    expect(second.username).toBe('jdoe2');
    expect(second.displayName).toBe('Alex Example');
    expect(second.email).toBe('jane@example.test');

    expect(second.roles).toEqual(['Admin']);
  });

  it('clears the email when the directory stops sending one', async () => {
    const users = new DrizzleUserRepository(db);
    await users.upsertFromIdentity({
      externalId: 'guid-3',
      username: 'jdoe',
      displayName: 'A Example',
      email: 'jdoe@example.test',
    });

    const updated = await users.upsertFromIdentity({
      externalId: 'guid-3',
      username: 'jdoe',
      displayName: 'A Example',
    });

    expect(updated.email).toBeUndefined();
  });

  it('returns null for an unknown id', async () => {
    const users = new DrizzleUserRepository(db);
    expect(await users.findById('00000000-0000-7000-8000-000000000000')).toBeNull();
  });

  it('drops a stored role that is not in the catalog', async () => {
    const users = new DrizzleUserRepository(db);
    const user = await users.upsertFromIdentity({
      externalId: 'guid-roles',
      username: 'jdoe',
      displayName: 'A Example',
    });

    await pool.query(`update identity.users set roles = ARRAY['Admin','Sorcerer'] where id = $1`, [
      user.id,
    ]);

    expect((await users.findById(user.id))?.roles).toEqual(['Admin']);
  });

  it('findByExternalId returns null for an unknown externalId, the user otherwise', async () => {
    const users = new DrizzleUserRepository(db);
    expect(await users.findByExternalId('nobody')).toBeNull();
    const created = await users.upsertFromIdentity({
      externalId: 'guid-find',
      username: 'jdoe',
      displayName: 'A Example',
    });
    expect((await users.findByExternalId('guid-find'))?.id).toBe(created.id);
  });

  it('findByUsername answers with the account holding the name now', async () => {
    const users = new DrizzleUserRepository(db);
    expect(await users.findByUsername('nobody')).toBeNull();

    const departed = await users.upsertFromIdentity({
      externalId: 'guid-departed',
      username: 'jsmith',
      displayName: 'Taylor Example',
      email: 'john.smith@example.test',
    });
    const newHire = await users.upsertFromIdentity({
      externalId: 'guid-new-hire',
      username: 'jsmith',
      displayName: 'Jordan Example',
      email: 'jane.smith@example.test',
    });

    await pool.query(`update identity.users set updated_at = $2 where id = $1`, [
      departed.id,
      '2026-01-02T00:00:00Z',
    ]);
    await pool.query(`update identity.users set updated_at = $2 where id = $1`, [
      newHire.id,
      '2026-06-01T00:00:00Z',
    ]);

    const found = await users.findByUsername('jsmith');
    expect(found?.id).toBe(newHire.id);
    expect(found?.email).toBe('jane.smith@example.test');

    await pool.query(`update identity.users set updated_at = $2 where id = $1`, [
      departed.id,
      '2026-09-01T00:00:00Z',
    ]);
    expect((await users.findByUsername('jsmith'))?.id).toBe(departed.id);
  });

  it('findByUsernames resolves several names in one read, newest row per name', async () => {
    const users = new DrizzleUserRepository(db);
    expect(await users.findByUsernames([])).toEqual([]);

    const departed = await users.upsertFromIdentity({
      externalId: 'guid-batch-departed',
      username: 'batch-jsmith',
      displayName: 'Taylor Example',
    });
    const newHire = await users.upsertFromIdentity({
      externalId: 'guid-batch-new-hire',
      username: 'batch-jsmith',
      displayName: 'Jordan Example',
    });
    await users.upsertFromIdentity({
      externalId: 'guid-batch-other',
      username: 'batch-adam',
      displayName: 'Adam Example',
    });

    await pool.query(`update identity.users set updated_at = $2 where id = $1`, [
      departed.id,
      '2026-01-02T00:00:00Z',
    ]);
    await pool.query(`update identity.users set updated_at = $2 where id = $1`, [
      newHire.id,
      '2026-06-01T00:00:00Z',
    ]);

    const found = await users.findByUsernames([
      'batch-jsmith',
      'batch-jsmith',
      'batch-nobody',
      'batch-adam',
    ]);

    expect(found.map((u) => u.username)).toEqual(['batch-adam', 'batch-jsmith']);
    expect(found[1]?.id).toBe(newHire.id);
  });

  it('setRoles replaces the role set, returns null for an unknown id', async () => {
    const users = new DrizzleUserRepository(db);
    expect(await users.setRoles('00000000-0000-7000-8000-000000000000', ['Sales'])).toBeNull();

    const created = await users.upsertFromIdentity({
      externalId: 'guid-setroles',
      username: 'jdoe',
      displayName: 'A Example',
    });
    const withRoles = await users.setRoles(created.id, ['Sales', 'Billing']);
    expect(withRoles?.roles).toEqual(['Sales', 'Billing']);

    const replaced = await users.setRoles(created.id, ['Admin']);
    expect(replaced?.roles).toEqual(['Admin']);
  });

  it('listByRole finds every holder, ordered, and only that role', async () => {
    const users = new DrizzleUserRepository(db);
    const zoe = await users.upsertFromIdentity({
      externalId: 'guid-pm-z',
      username: 'zoe-pm',
      displayName: 'Zoe PM',
    });
    const adam = await users.upsertFromIdentity({
      externalId: 'guid-pm-a',
      username: 'adam-pm',
      displayName: 'Adam PM',
    });
    const sam = await users.upsertFromIdentity({
      externalId: 'guid-pm-s',
      username: 'sam-sales',
      displayName: 'Sam Sales',
    });
    await users.setRoles(zoe.id, ['ProductionManager']);
    await users.setRoles(adam.id, ['ProductionManager', 'Production']);
    await users.setRoles(sam.id, ['Sales']);

    const found = await users.listByRole('ProductionManager');
    const usernames = found.map((u) => u.username);

    expect(usernames).toContain('zoe-pm');
    expect(usernames).toContain('adam-pm');
    expect(usernames).not.toContain('sam-sales');

    expect(usernames).toEqual([...usernames].sort());

    expect((await users.listByRole('Production')).map((u) => u.username)).not.toContain('zoe-pm');
  });

  it('setRoles dedupes duplicate roles supplied by the caller', async () => {
    const users = new DrizzleUserRepository(db);
    const created = await users.upsertFromIdentity({
      externalId: 'guid-dedup',
      username: 'jdoe',
      displayName: 'A Example',
    });
    const updated = await users.setRoles(created.id, ['Sales', 'Sales', 'Billing']);
    expect(updated?.roles).toEqual(['Sales', 'Billing']);
  });
});

describeDb('DrizzleSessionStore', () => {
  async function aUser(externalId: string): Promise<string> {
    const user = await new DrizzleUserRepository(db).upsertFromIdentity({
      externalId,
      username: externalId,
      displayName: externalId,
    });
    return user.id;
  }

  function aSession(userId: string, tokenHash: string) {
    const now = new Date();
    return {
      tokenHash,
      userId,
      issuedAt: now,
      lastSeenAt: now,
      absoluteExpiresAt: new Date(now.getTime() + 60_000),
    };
  }

  it('round-trips a session and finds it by token hash', async () => {
    const sessions = new DrizzleSessionStore(db);
    const userId = await aUser('guid-session-1');

    const created = await sessions.create(aSession(userId, 'hash-1'));
    const found = await sessions.findByTokenHash('hash-1');

    expect(found).not.toBeNull();
    expect(found?.id).toBe(created.id);
    expect(found?.userId).toBe(userId);
  });

  it('moves lastSeenAt on touch', async () => {
    const sessions = new DrizzleSessionStore(db);
    const userId = await aUser('guid-session-2');
    const created = await sessions.create(aSession(userId, 'hash-2'));

    const later = new Date(created.lastSeenAt.getTime() + 30_000);
    await sessions.touch(created.id, later);

    expect((await sessions.findByTokenHash('hash-2'))?.lastSeenAt.getTime()).toBe(later.getTime());
  });

  it('deletes a single session', async () => {
    const sessions = new DrizzleSessionStore(db);
    const userId = await aUser('guid-session-3');
    const created = await sessions.create(aSession(userId, 'hash-3'));

    await sessions.delete(created.id);

    expect(await sessions.findByTokenHash('hash-3')).toBeNull();
  });

  it('cascades so deleting a user leaves no live sessions behind', async () => {
    const sessions = new DrizzleSessionStore(db);
    const userId = await aUser('guid-session-6');
    await sessions.create(aSession(userId, 'hash-6'));

    await pool.query('delete from identity.users where id = $1', [userId]);

    expect(await sessions.findByTokenHash('hash-6')).toBeNull();
  });
});

describeDb('DrizzleBreakGlassStore', () => {
  it('reports an unprovisioned account as null', async () => {
    expect(await new DrizzleBreakGlassStore(db).load()).toBeNull();
  });

  it('persists lockout state, which is what makes the five-strike limit real', async () => {
    const store = new DrizzleBreakGlassStore(db);
    const policy = { maxFailures: 5, lockoutMs: 15 * 60_000 };
    const now = new Date();
    await store.setPassword('hash');

    for (let i = 0; i < 5; i += 1) {
      await store.recordFailure(policy, now);
    }

    const loaded = await new DrizzleBreakGlassStore(createIdentityDb(pool)).load();
    expect(loaded?.passwordHash).toBe('hash');
    expect(loaded?.consecutiveFailures).toBe(5);
    expect(loaded?.lockedUntil?.getTime()).toBe(now.getTime() + policy.lockoutMs);
  });

  it('counts every one of twenty failures recorded at once', async () => {
    const store = new DrizzleBreakGlassStore(db);
    const policy = { maxFailures: 50, lockoutMs: 15 * 60_000 };
    const now = new Date();
    await store.setPassword('hash');

    const counted = await Promise.all(
      Array.from({ length: 20 }, () => store.recordFailure(policy, now)),
    );

    expect((await store.load())?.consecutiveFailures).toBe(20);
    expect(
      counted
        .map((failure) => failure?.after.consecutiveFailures)
        .sort((a, b) => (a ?? 0) - (b ?? 0)),
    ).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
  });

  it('updates the one row in place rather than accumulating rows', async () => {
    const store = new DrizzleBreakGlassStore(db);
    await store.setPassword('first');
    await store.recordFailure({ maxFailures: 5, lockoutMs: 60_000 }, new Date());
    await store.setPassword('second');

    const { rows } = await pool.query<{ count: string }>(
      'select count(*)::text as count from identity.break_glass',
    );

    expect(rows[0]?.count).toBe('1');
    expect(await store.load()).toEqual({
      passwordHash: 'second',
      consecutiveFailures: 0,
      lockedUntil: null,
    });
  });

  it('stores a real argon2id hash the hasher can verify', async () => {
    const store = new DrizzleBreakGlassStore(db);
    const hasher = new Argon2PasswordHasher();
    await store.setPassword(await hasher.hash('a-sealed-emergency-password'));

    const loaded = await store.load();
    expect(loaded).not.toBeNull();

    expect(await hasher.verify(loaded!.passwordHash, 'a-sealed-emergency-password')).toBe(true);
  });
});

describeDb('sessions outlive the process', () => {
  function serviceOver(handle: IdentityDb): AuthenticationService {
    return new AuthenticationService({
      provider: new LocalAuthProvider(DEV_PASSWORD),
      users: new DrizzleUserRepository(handle),
      sessions: new DrizzleSessionStore(handle),
      breakGlass: new DrizzleBreakGlassStore(handle),
      hasher: fakeHasher,
      audit: silentAudit,
      alerts: silentAlerts,
      clock: systemClock,
      breakGlassUsername: 'break-glass',
    });
  }

  it('resolves a token issued by an earlier service instance', async () => {
    const before = serviceOver(db);
    const login = await before.login('dev-sales', DEV_PASSWORD);
    expect(login.ok).toBe(true);
    if (!login.ok) {
      return;
    }

    const after = serviceOver(createIdentityDb(pool));
    const resolved = await after.resolveSession(login.token);

    expect(resolved).not.toBeNull();
    expect(resolved?.user.username).toBe('dev-sales');
    expect(resolved?.user.id).toBe(login.user.id);
  });

  it('stops honoring the token once the user logs out', async () => {
    const service = serviceOver(db);
    const login = await service.login('dev-billing', DEV_PASSWORD);
    if (!login.ok) {
      throw new Error('login should have succeeded');
    }

    await service.logout(login.token);

    expect(await serviceOver(createIdentityDb(pool)).resolveSession(login.token)).toBeNull();
  });
});
