// An Admin role grant never changes a stored username. For a user who exists it changes the roles and refreshes the
// display name and email from the identity sent. It never touches the break-glass account or its reserved name.
// Runs `AdminRoleService` from modules/identity/src/admin-role-service.ts on both user repository adapters, the
// PostgreSQL half only with `DATABASE_URL`. `pnpm test:db` supplies a throwaway Postgres.
import { resolve } from 'node:path';

import { moduleTestDatabase } from '@erp/db';
import type { VerifiedIdentity } from '@erp/types';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { DrizzleUserRepository } from '../src/adapters/drizzle/drizzle-user-repository';
import { InMemoryUserRepository } from '../src/adapters/in-memory/in-memory-user-repository';
import { AdminRoleService } from '../src/admin-role-service';
import { BREAK_GLASS_EXTERNAL_ID } from '../src/authentication-service';
import { createIdentityDb } from '../src/data/identity-db';
import { LocalLdapDirectory } from '../src/providers/local-directory';
import type { AuditEvent, ErpUser, UserRepository } from '../src/ports';

const ACTOR: ErpUser = {
  id: 'actor-grant-check',
  externalId: 'guid-grant-actor',
  username: 'grant.actor',
  displayName: 'Grant Actor',
  roles: ['Admin'],
};

const STORED: VerifiedIdentity = {
  externalId: 'guid-ledger-reader',
  username: 'ledger.reader',
  displayName: 'Ledger Reader',
  email: 'ledger.reader@example.test',
};

// The reserved break-glass name this service is configured with. Not the default, so the test shows it is read.
const RESERVED_NAME = 'standby.admin';

const SENT_ELSEWISE: VerifiedIdentity = {
  externalId: STORED.externalId,
  username: 'press.writer',
  displayName: 'Press Writer',
  email: 'press.writer@example.test',
};

function adminService(users: UserRepository, audit: AuditEvent[]): AdminRoleService {
  return new AdminRoleService({
    users,
    directory: new LocalLdapDirectory([]),
    audit: { record: async (event) => void audit.push(event) },
    clock: { now: () => new Date('2026-10-05T13:00:00.000Z') },
    breakGlassUsername: RESERVED_NAME,
  });
}

function grantContract(makeUsers: () => Promise<UserRepository>): void {
  let users: UserRepository;
  let audit: AuditEvent[];
  let admin: AdminRoleService;

  beforeEach(async () => {
    users = await makeUsers();
    audit = [];
    admin = adminService(users, audit);
  });

  it('keeps the stored username of a user who exists and refreshes the display name and email', async () => {
    const signedIn = await users.upsertFromIdentity(STORED);

    const outcome = await admin.setRolesForUser(
      STORED.externalId,
      { identity: SENT_ELSEWISE, roles: ['Billing'] },
      { actor: ACTOR },
    );

    expect(outcome.ok).toBe(true);
    const stored = await users.findById(signedIn.id);
    expect(stored).toEqual({
      id: signedIn.id,
      externalId: STORED.externalId,
      username: 'ledger.reader',
      displayName: 'Press Writer',
      email: 'press.writer@example.test',
      roles: ['Billing'],
    });
    if (outcome.ok) {
      expect(outcome.user).toEqual(stored);
    }
    expect(audit.map((event) => event.detail)).toEqual([
      'actor=grant.actor target=ledger.reader added=Billing removed=(none)',
    ]);
  });

  it('keeps the stored name through a revoke that sends another one', async () => {
    const signedIn = await users.upsertFromIdentity(STORED);
    await users.setRoles(signedIn.id, ['Sales', 'Billing']);

    await admin.setRolesForUser(
      STORED.externalId,
      { identity: SENT_ELSEWISE, roles: ['Sales'] },
      { actor: ACTOR },
    );

    expect((await users.findById(signedIn.id))?.username).toBe('ledger.reader');
    expect((await users.findById(signedIn.id))?.roles).toEqual(['Sales']);
  });

  it('gives an existing user the email the directory now lists, and clears one it no longer lists', async () => {
    const signedIn = await users.upsertFromIdentity({
      externalId: STORED.externalId,
      username: STORED.username,
      displayName: STORED.displayName,
    });

    await admin.setRolesForUser(
      STORED.externalId,
      { identity: STORED, roles: ['Sales'] },
      { actor: ACTOR },
    );
    expect((await users.findById(signedIn.id))?.email).toBe('ledger.reader@example.test');
    expect((await users.listByRole('Sales')).map((holder) => holder.email)).toEqual([
      'ledger.reader@example.test',
    ]);

    await admin.setRolesForUser(
      STORED.externalId,
      {
        identity: {
          externalId: STORED.externalId,
          username: STORED.username,
          displayName: STORED.displayName,
        },
        roles: ['Sales'],
      },
      { actor: ACTOR },
    );
    expect(await users.findById(signedIn.id)).not.toHaveProperty('email');
  });

  it.each([
    ['as it is configured', RESERVED_NAME],
    ['in other case', 'Standby.Admin'],
  ])(
    'refuses an identity carrying the reserved break-glass name %s for a new external id, and stores nothing',
    async (_label, reserved) => {
      const outcome = await admin.setRolesForUser(
        'guid-reserved-claimant',
        {
          identity: {
            externalId: 'guid-reserved-claimant',
            username: reserved,
            displayName: 'Reserved Claimant',
          },
          roles: ['Admin'],
        },
        { actor: ACTOR },
      );

      expect(outcome).toEqual({ ok: false, reason: 'directory-mismatch' });
      expect(await users.findByExternalId('guid-reserved-claimant')).toBeNull();
      expect(await users.listByRole('Admin')).toEqual([]);
      expect(audit).toEqual([]);
    },
  );

  it('refuses an identity carrying the reserved break-glass name for a user who exists, and leaves them alone', async () => {
    const signedIn = await users.upsertFromIdentity(STORED);

    const outcome = await admin.setRolesForUser(
      STORED.externalId,
      {
        identity: { ...SENT_ELSEWISE, username: RESERVED_NAME },
        roles: ['Admin'],
      },
      { actor: ACTOR },
    );

    expect(outcome).toEqual({ ok: false, reason: 'directory-mismatch' });
    expect(await users.findById(signedIn.id)).toEqual(signedIn);
    expect(audit).toEqual([]);
  });

  it('creates a user who has never signed in from the identity sent, and the first sign-in replaces it', async () => {
    const outcome = await admin.setRolesForUser(
      SENT_ELSEWISE.externalId,
      { identity: SENT_ELSEWISE, roles: ['Sales'] },
      { actor: ACTOR },
    );
    expect(outcome.ok).toBe(true);
    expect((await users.findByExternalId(STORED.externalId))?.username).toBe('press.writer');

    const signedIn = await users.upsertFromIdentity(STORED);

    expect(signedIn.username).toBe('ledger.reader');
    expect(signedIn.roles).toEqual(['Sales']);
  });

  it('refuses the break-glass external id and stores nothing', async () => {
    const outcome = await admin.setRolesForUser(
      BREAK_GLASS_EXTERNAL_ID,
      {
        identity: {
          externalId: BREAK_GLASS_EXTERNAL_ID,
          username: 'press.writer',
          displayName: 'Press Writer',
        },
        roles: ['Sales'],
      },
      { actor: ACTOR },
    );

    expect(outcome).toEqual({ ok: false, reason: 'directory-mismatch' });
    expect(await users.findByExternalId(BREAK_GLASS_EXTERNAL_ID)).toBeNull();
    expect(audit).toEqual([]);
  });

  it('refuses the break-glass external id when its row exists, and leaves the row alone', async () => {
    const row = await users.upsertFromIdentity({
      externalId: BREAK_GLASS_EXTERNAL_ID,
      username: 'break-glass',
      displayName: 'Break-glass administrator',
    });

    const outcome = await admin.setRolesForUser(
      BREAK_GLASS_EXTERNAL_ID,
      {
        identity: {
          externalId: BREAK_GLASS_EXTERNAL_ID,
          username: 'press.writer',
          displayName: 'Press Writer',
        },
        roles: ['Sales'],
      },
      { actor: ACTOR },
    );

    expect(outcome).toEqual({ ok: false, reason: 'directory-mismatch' });
    expect(await users.findById(row.id)).toEqual(row);
    expect(audit).toEqual([]);
  });
}

describe('an Admin role grant, in memory', () => {
  grantContract(async () => new InMemoryUserRepository());
});

const testDb = moduleTestDatabase({
  moduleName: 'identity',
  migrationsFolder: resolve(__dirname, '../../../infra/db/migrations/identity'),
  isolationKey: 'admin_grant',
});

const describeDb = testDb.enabled ? describe : describe.skip;

describeDb('an Admin role grant, in PostgreSQL', () => {
  beforeAll(async () => {
    await testDb.setup();
  }, 180_000);

  afterAll(async () => {
    await testDb.teardown();
  });

  beforeEach(async () => {
    await testDb.truncate(['identity.sessions', 'identity.users']);
  });

  grantContract(async () => new DrizzleUserRepository(createIdentityDb(testDb.pool)));
});
