// Tests modules/identity/src/admin-role-service.ts on the in-memory user repository: directory search,
// role assignment with its audit events, the role-holder lists, and that break-glass stays out of all three.
import { ERP_ROLES, type ErpRole } from '@erp/types';
import { beforeEach, describe, expect, it } from 'vitest';

import { AdminRoleService } from '../src/admin-role-service';
import { BREAK_GLASS_EXTERNAL_ID } from '../src/authentication-service';
import { InMemoryUserRepository } from '../src/adapters/in-memory/in-memory-user-repository';
import { LocalLdapDirectory } from '../src/providers/local-directory';
import type { AuditEvent, AuditSink, Clock, ErpUser } from '../src/ports';
import type { LdapDirectory, LdapDirectoryUser } from '../src/providers/ldap-directory';

const NOW = new Date('2026-08-04T09:00:00.000Z');

const staticClock: Clock = { now: () => NOW };

class RecordingAudit implements AuditSink {
  events: AuditEvent[] = [];
  async record(event: AuditEvent): Promise<void> {
    this.events.push(event);
  }
  get types(): string[] {
    return this.events.map((e) => e.type);
  }
}

class StubDirectory implements LdapDirectory {
  constructor(private readonly rows: LdapDirectoryUser[]) {}
  async searchUsers(_q: string, limit: number): Promise<readonly LdapDirectoryUser[]> {
    return this.rows.slice(0, limit);
  }
}

function newActor(): ErpUser {
  return {
    id: 'actor-id',
    externalId: 'local:dev-admin',
    username: 'dev-admin',
    displayName: 'dev-admin',
    roles: ['Admin'],
  };
}

describe('AdminRoleService.searchUsers', () => {
  let users: InMemoryUserRepository;
  let audit: RecordingAudit;
  let svc: AdminRoleService;

  beforeEach(() => {
    users = new InMemoryUserRepository();
    audit = new RecordingAudit();
    svc = new AdminRoleService({
      users,
      directory: new LocalLdapDirectory(),
      audit,
      clock: staticClock,
      breakGlassUsername: 'break-glass',
    });
  });

  it('returns rows with empty roles when no user has been provisioned yet', async () => {
    const rows = await svc.searchUsers('dev-sales');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.roles).toEqual([]);
    expect(rows[0]?.alreadyProvisioned).toBe(false);
  });

  it('attaches roles from an already-provisioned user', async () => {
    const provisioned = await users.upsertFromIdentity({
      externalId: 'local:dev-sales',
      username: 'dev-sales',
      displayName: 'dev-sales',
    });
    await users.setRoles(provisioned.id, ['Sales']);

    const rows = await svc.searchUsers('dev-sales');
    expect(rows[0]?.roles).toEqual(['Sales']);
    expect(rows[0]?.alreadyProvisioned).toBe(true);
  });

  it('filters the break-glass sentinel externalId out of results', async () => {
    const stubDir = new StubDirectory([
      {
        externalId: BREAK_GLASS_EXTERNAL_ID,
        username: 'break-glass',
        displayName: 'Break-glass',
        disabled: false,
      },
      {
        externalId: 'ad-guid-2',
        username: 'realuser',
        displayName: 'Real User',
        disabled: false,
      },
    ]);
    const bgSvc = new AdminRoleService({
      users,
      directory: stubDir,
      audit,
      clock: staticClock,
      breakGlassUsername: 'break-glass',
    });
    const rows = await bgSvc.searchUsers('');
    expect(rows.map((r) => r.externalId)).toEqual(['ad-guid-2']);
  });
});

describe('AdminRoleService.setRolesForUser', () => {
  let users: InMemoryUserRepository;
  let audit: RecordingAudit;
  let svc: AdminRoleService;

  beforeEach(() => {
    users = new InMemoryUserRepository();
    audit = new RecordingAudit();
    svc = new AdminRoleService({
      users,
      directory: new LocalLdapDirectory(),
      audit,
      clock: staticClock,
      breakGlassUsername: 'break-glass',
    });
  });

  const identity = {
    externalId: 'ad-guid-1',
    username: 'jsmith',
    displayName: 'Taylor Example',
  };

  it('refuses a request where the URL externalId disagrees with the body', async () => {
    const result = await svc.setRolesForUser(
      'someone-else',
      { identity, roles: ['Sales'] },
      { actor: newActor() },
    );
    expect(result).toEqual({ ok: false, reason: 'directory-mismatch' });
    expect(audit.events).toHaveLength(0);
  });

  it('provisions a never-seen user and sets their roles atomically', async () => {
    const result = await svc.setRolesForUser(
      identity.externalId,
      { identity, roles: ['Sales', 'Billing'] },
      { actor: newActor() },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.user.username).toBe('jsmith');
      expect(result.user.roles).toEqual(['Sales', 'Billing']);
    }
    const persisted = await users.findByExternalId(identity.externalId);
    expect(persisted?.roles).toEqual(['Sales', 'Billing']);
  });

  it('records role.granted when roles were added', async () => {
    await svc.setRolesForUser(
      identity.externalId,
      { identity, roles: ['Sales'] },
      { actor: newActor() },
    );
    expect(audit.types).toEqual(['role.granted']);
    expect(audit.events[0]?.detail).toContain('added=Sales');
    expect(audit.events[0]?.detail).toContain('removed=(none)');
  });

  it('records role.revoked when roles were removed', async () => {
    await svc.setRolesForUser(
      identity.externalId,
      { identity, roles: ['Sales', 'Billing'] },
      { actor: newActor() },
    );
    audit.events.length = 0;

    await svc.setRolesForUser(
      identity.externalId,
      { identity, roles: ['Sales'] },
      { actor: newActor() },
    );
    expect(audit.types).toEqual(['role.revoked']);
    expect(audit.events[0]?.detail).toContain('removed=Billing');
  });

  it('records both granted and revoked when the two overlap', async () => {
    await svc.setRolesForUser(
      identity.externalId,
      { identity, roles: ['Sales'] },
      { actor: newActor() },
    );
    audit.events.length = 0;

    await svc.setRolesForUser(
      identity.externalId,
      { identity, roles: ['Billing'] },
      { actor: newActor() },
    );
    expect(audit.types.sort()).toEqual(['role.granted', 'role.revoked']);
  });

  it('records nothing on a no-op assignment (idempotent replay does not spam audit)', async () => {
    await svc.setRolesForUser(
      identity.externalId,
      { identity, roles: ['Sales'] },
      { actor: newActor() },
    );
    audit.events.length = 0;

    await svc.setRolesForUser(
      identity.externalId,
      { identity, roles: ['Sales'] },
      { actor: newActor() },
    );
    expect(audit.events).toHaveLength(0);
  });

  it('carries actor identity into the audit detail', async () => {
    const actor = newActor();
    await svc.setRolesForUser(
      identity.externalId,
      { identity, roles: ['Sales'] },
      { actor, sourceIp: '192.0.2.1' },
    );
    expect(audit.events[0]?.username).toBe(actor.username);
    expect(audit.events[0]?.sourceIp).toBe('192.0.2.1');
    expect(audit.events[0]?.detail).toContain(`actor=${actor.username}`);
    expect(audit.events[0]?.detail).toContain('target=jsmith');
  });
});

describe('AdminRoleService.listRoleHolders', () => {
  let users: InMemoryUserRepository;
  let svc: AdminRoleService;

  beforeEach(() => {
    users = new InMemoryUserRepository();
    svc = new AdminRoleService({
      users,
      directory: new LocalLdapDirectory(),
      audit: new RecordingAudit(),
      clock: staticClock,
      breakGlassUsername: 'break-glass',
    });
  });

  async function grant(
    username: string,
    roles: readonly ErpRole[],
    email?: string,
  ): Promise<ErpUser> {
    const user = await users.upsertFromIdentity({
      externalId: `local:${username}`,
      username,
      displayName: username,
      ...(email === undefined ? {} : { email }),
    });
    const updated = await users.setRoles(user.id, roles);
    if (updated === null) throw new Error('seed failed');
    return updated;
  }

  it('returns every role in the catalog, in catalog order', async () => {
    const catalog = await svc.listRoleHolders();
    expect(catalog.map((entry) => entry.role)).toEqual([...ERP_ROLES]);
  });

  it('reports a role nobody holds as an empty list, not as an absence', async () => {
    const catalog = await svc.listRoleHolders();
    const ar = catalog.find((entry) => entry.role === 'Billing');
    expect(ar).toBeDefined();
    expect(ar?.holders).toEqual([]);
  });

  it('lists the holders of a role, ordered by username', async () => {
    await grant('zoe', ['Billing'], 'zoe@example.test');
    await grant('adam', ['Billing'], 'adam@example.test');

    const ar = (await svc.listRoleHolders()).find((entry) => entry.role === 'Billing');
    expect(ar?.holders.map((h) => h.username)).toEqual(['adam', 'zoe']);
    expect(ar?.holders[0]).toEqual({
      externalId: 'local:adam',
      username: 'adam',
      displayName: 'adam',
      email: 'adam@example.test',
    });
  });

  it('omits email rather than sending null for a holder with no address', async () => {
    await grant('no-mail', ['Billing']);
    const ar = (await svc.listRoleHolders()).find((entry) => entry.role === 'Billing');
    expect(ar?.holders[0]).not.toHaveProperty('email');
  });

  it('puts a user holding two roles under both', async () => {
    await grant('both', ['Billing', 'ProductionManager'], 'both@example.test');
    const catalog = await svc.listRoleHolders();
    expect(catalog.find((e) => e.role === 'Billing')?.holders.map((h) => h.username)).toEqual([
      'both',
    ]);
    expect(
      catalog.find((e) => e.role === 'ProductionManager')?.holders.map((h) => h.username),
    ).toEqual(['both']);

    expect(catalog.find((e) => e.role === 'Sales')?.holders).toEqual([]);
  });

  it('does not apply the search cap — a role may have more than 50 holders', async () => {
    for (let i = 0; i < 60; i += 1) {
      await grant(`ar-${String(i).padStart(3, '0')}`, ['Billing'], `ar${String(i)}@example.test`);
    }
    const ar = (await svc.listRoleHolders()).find((entry) => entry.role === 'Billing');
    expect(ar?.holders).toHaveLength(60);
  });

  it('never lists the break-glass account, whatever roles its row carries', async () => {
    const bg = await users.upsertFromIdentity({
      externalId: BREAK_GLASS_EXTERNAL_ID,
      username: 'break-glass',
      displayName: 'Break-glass administrator',
    });
    await users.setRoles(bg.id, ['Admin']);

    const admin = (await svc.listRoleHolders()).find((entry) => entry.role === 'Admin');
    expect(admin?.holders).toEqual([]);
  });
});
