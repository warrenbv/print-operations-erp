// Tests modules/identity/src/dev-role-seed.ts: which local accounts get which roles.
import { describe, expect, it } from 'vitest';

import { InMemoryUserRepository } from '../src/adapters/in-memory/in-memory-user-repository';
import { DEV_USER_ROLES, seedDevRoles } from '../src/dev-role-seed';
import { DEV_USERNAMES } from '../src/providers/local-auth-provider';

describe('seedDevRoles', () => {
  it('gives each dev user its namesake role', async () => {
    const users = new InMemoryUserRepository();
    await seedDevRoles(users);

    for (const username of DEV_USERNAMES) {
      const expected = DEV_USER_ROLES[username];
      if (expected.length === 0) continue;
      const user = await users.findByExternalId(`local:${username}`);
      expect(user?.roles).toEqual(expected);
    }
  });

  it('keeps the floor and the manager apart', async () => {
    const users = new InMemoryUserRepository();
    await seedDevRoles(users);

    expect((await users.findByExternalId('local:dev-production'))?.roles).toEqual(['Production']);
    expect((await users.findByExternalId('local:dev-production-manager'))?.roles).toEqual([
      'ProductionManager',
    ]);
  });

  it('leaves dev-noroles alone, row and all', async () => {
    const users = new InMemoryUserRepository();
    await seedDevRoles(users);

    expect(await users.findByExternalId('local:dev-noroles')).toBeNull();
  });

  it('provisions the address a login would give them', async () => {
    const users = new InMemoryUserRepository();
    await seedDevRoles(users);

    expect((await users.findByExternalId('local:dev-billing'))?.email).toBe(
      'dev-billing@example.test',
    );
  });

  it('uses the externalId a real login produces, so signing in finds this row', async () => {
    const users = new InMemoryUserRepository();
    await seedDevRoles(users);

    const seeded = await users.findByExternalId('local:dev-sales');
    const afterLogin = await users.upsertFromIdentity({
      externalId: 'local:dev-sales',
      username: 'dev-sales',
      displayName: 'dev-sales',
    });

    expect(afterLogin.id).toBe(seeded?.id);
    expect(afterLogin.roles).toEqual(['Sales']);
  });

  it('is idempotent — a second run replaces rather than accumulates', async () => {
    const users = new InMemoryUserRepository();
    await seedDevRoles(users);
    await seedDevRoles(users);

    expect((await users.findByExternalId('local:dev-billing'))?.roles).toEqual(['Billing']);
    expect(await users.listByRole('Billing')).toHaveLength(1);
  });

  it('seeds only the accounts it is given', async () => {
    const users = new InMemoryUserRepository();
    await seedDevRoles(users, ['dev-sales', 'dev-admin']);

    expect((await users.findByExternalId('local:dev-admin'))?.roles).toEqual(['Admin']);
    expect(await users.findByExternalId('local:dev-billing')).toBeNull();
    expect(await users.findByExternalId('local:dev-production')).toBeNull();
  });
});

describe('DEV_USER_ROLES', () => {
  it('decides every name in the roster', () => {
    for (const username of DEV_USERNAMES) {
      expect(DEV_USER_ROLES[username]).toBeDefined();
    }
  });
});
