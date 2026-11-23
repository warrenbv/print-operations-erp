// Tests that the local sign-in provider takes its password and roster from configuration and refuses to start without either.
// It signs in, seeds and shows Admin exactly the accounts named in LOCAL_AUTH_USERS.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createAdminRoleService } from '../src/admin/admin.factory';
import { createAuthenticationService, createIdentityStores } from '../src/auth/auth.factory';

const KEYS = [
  'NODE_ENV',
  'AUTH_PROVIDER',
  'DATA_PERSISTENCE',
  'DATABASE_URL',
  'DEV_SEED_ROLES',
  'LOCAL_AUTH_PASSWORD',
  'LOCAL_AUTH_USERS',
  'BREAK_GLASS_DEV_PASSWORD',
] as const;

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));
  for (const key of KEYS) delete process.env[key];
  process.env.NODE_ENV = 'test';
  process.env.AUTH_PROVIDER = 'local';
  process.env.DATA_PERSISTENCE = 'memory';
});

afterEach(() => {
  for (const key of KEYS) {
    const value = saved[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

async function boot() {
  const stores = await createIdentityStores();
  const auth = await createAuthenticationService(stores);
  return { stores, auth };
}

describe('the local sign-in provider takes its password and roster from configuration only', () => {
  it('refuses to start without a password', async () => {
    process.env.LOCAL_AUTH_USERS = 'dev-sales';
    await expect(boot()).rejects.toThrow(/LOCAL_AUTH_PASSWORD is not set/);
  });

  it('refuses to start without a roster', async () => {
    process.env.LOCAL_AUTH_PASSWORD = 'example-password';
    await expect(boot()).rejects.toThrow(/LOCAL_AUTH_USERS is not set/);
  });

  it('refuses a roster naming an account the provider does not have', async () => {
    process.env.LOCAL_AUTH_PASSWORD = 'example-password';
    process.env.LOCAL_AUTH_USERS = 'dev-sales,someone-else';
    await expect(boot()).rejects.toThrow(/someone-else/);
  });

  it('signs in exactly the listed accounts, seeds only them, and shows only them to Admin', async () => {
    process.env.LOCAL_AUTH_PASSWORD = 'example-password';
    process.env.LOCAL_AUTH_USERS = 'dev-sales,dev-admin';
    process.env.DEV_SEED_ROLES = 'true';
    const { stores, auth } = await boot();

    const listed = await auth.login('dev-sales', 'example-password', {});
    expect(listed.ok).toBe(true);
    for (const unlisted of ['dev-production', 'dev-noroles', 'dev-billing']) {
      expect((await auth.login(unlisted, 'example-password', {})).ok).toBe(false);
    }
    expect((await auth.login('dev-sales', 'wrong-password', {})).ok).toBe(false);

    expect(await stores.users.findByExternalId('local:dev-production')).toBeNull();
    expect((await stores.users.findByExternalId('local:dev-admin'))?.roles).toEqual(['Admin']);

    const admin = await createAdminRoleService(stores);
    const directory = await admin.searchUsers('');
    expect(directory.map((row) => row.username)).toEqual(['dev-sales', 'dev-admin']);
  });
});
