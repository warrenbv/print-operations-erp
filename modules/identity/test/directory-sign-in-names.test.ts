// One directory account answers to two sign-in names, its account name and its principal name. Runs
// `AuthenticationService` with modules/identity/src/providers/ldap-auth-provider.ts over a scripted directory, on
// both user repository adapters, and checks that either name leaves one stored username, the account name.
// The PostgreSQL half skips without `DATABASE_URL`. `pnpm test:db` supplies a throwaway Postgres.
import { resolve } from 'node:path';

import { moduleTestDatabase } from '@erp/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { DrizzleSessionStore } from '../src/adapters/drizzle/drizzle-session-store';
import { DrizzleUserRepository } from '../src/adapters/drizzle/drizzle-user-repository';
import { InMemoryBreakGlassStore } from '../src/adapters/in-memory/in-memory-break-glass-store';
import { InMemorySessionStore } from '../src/adapters/in-memory/in-memory-session-store';
import { InMemoryUserRepository } from '../src/adapters/in-memory/in-memory-user-repository';
import { AuthenticationService } from '../src/authentication-service';
import { createIdentityDb } from '../src/data/identity-db';
import type { LdapConfig } from '../src/domain/ldap-config';
import { LdapAuthProvider } from '../src/providers/ldap-auth-provider';
import type { LdapClientFactory, LdapUserEntry } from '../src/providers/ldap-client';
import type { SessionStore, UserRepository } from '../src/ports';

const ACCOUNT_NAME = 'Case.Reader';
const PRINCIPAL_NAME = 'case.reader@example.test';
const PASSWORD = 'reader-password';

const CONFIG: LdapConfig = {
  urls: ['ldaps://dc.example.test:636'],
  bindDn: 'CN=lookup,DC=example,DC=test',
  bindPassword: 'lookup-password',
  userBaseDn: 'OU=Staff,DC=example,DC=test',
  caCertificate: Buffer.from('ca'),
  timeoutMs: 1000,
};

const ENTRY: LdapUserEntry = {
  dn: 'CN=Case Reader,OU=Staff,DC=example,DC=test',
  objectGuid: '5d0c2e7a91b84f36a2c1e09b7d43f518',
  sAMAccountName: ACCOUNT_NAME,
  displayName: 'Case Reader',
  mail: PRINCIPAL_NAME,
  userAccountControl: 0x0200,
};

// A directory holding one entry. A search answers that entry when the filter names its account name or its
// principal name, as a directory would for the filter the provider builds.
const directory: LdapClientFactory = async () => ({
  bind: async () => {},
  search: async (_baseDn, filter) => {
    const asked = [...filter.matchAll(/(sAMAccountName|userPrincipalName)=([^)]*)\)/g)];
    const matches = asked.some(
      ([, attribute, value]) =>
        (attribute === 'sAMAccountName' && value === ACCOUNT_NAME.toLowerCase()) ||
        (attribute === 'userPrincipalName' && value === PRINCIPAL_NAME),
    );
    return matches ? [ENTRY] : [];
  },
  unbind: async () => {},
});

function service(users: UserRepository, sessions: SessionStore): AuthenticationService {
  return new AuthenticationService({
    provider: new LdapAuthProvider(CONFIG, directory),
    users,
    sessions,
    breakGlass: new InMemoryBreakGlassStore(null),
    hasher: { hash: async (p) => p, verify: async () => false },
    audit: { record: async () => undefined },
    alerts: { raise: async () => undefined },
    clock: { now: () => new Date() },
    breakGlassUsername: 'break-glass',
  });
}

async function signInUnderBothNames(users: UserRepository, sessions: SessionStore): Promise<void> {
  const auth = service(users, sessions);

  const byAccount = await auth.login(ACCOUNT_NAME, PASSWORD);
  const byPrincipal = await auth.login(PRINCIPAL_NAME, PASSWORD);
  if (!byAccount.ok || !byPrincipal.ok) {
    throw new Error('both sign-ins should succeed against the scripted directory');
  }

  expect(byAccount.user.username).toBe('case.reader');
  expect(byPrincipal.user.username).toBe('case.reader');
  expect(byPrincipal.user.id).toBe(byAccount.user.id);
  expect((await users.findById(byAccount.user.id))?.username).toBe('case.reader');

  // The session issued before the second sign-in resolves to the same stored name.
  expect((await auth.resolveSession(byAccount.token))?.user.username).toBe('case.reader');
}

describe('one directory account signed in under both of its names, in memory', () => {
  it('stores the account name both times', async () => {
    await signInUnderBothNames(new InMemoryUserRepository(), new InMemorySessionStore());
  });
});

const testDb = moduleTestDatabase({
  moduleName: 'identity',
  migrationsFolder: resolve(__dirname, '../../../infra/db/migrations/identity'),
  isolationKey: 'sign_in_names',
});

const describeDb = testDb.enabled ? describe : describe.skip;

beforeAll(async () => {
  if (!testDb.enabled) return;
  await testDb.setup();
}, 180_000);

afterAll(async () => {
  await testDb.teardown();
});

beforeEach(async () => {
  if (!testDb.enabled) return;
  await testDb.truncate(['identity.sessions', 'identity.users']);
});

describeDb('one directory account signed in under both of its names, in PostgreSQL', () => {
  it('stores the account name both times', async () => {
    const db = createIdentityDb(testDb.pool);
    await signInUnderBothNames(new DrizzleUserRepository(db), new DrizzleSessionStore(db));
  });
});
