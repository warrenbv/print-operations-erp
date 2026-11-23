// What the Admin page does: search the directory for people and set their roles. The ERP assigns roles
// only. It never creates directory accounts or sets passwords: docs/product/roles.md. The API allows the change
// to Admin alone in apps/api/src/admin/admin.controller.ts.
import {
  ERP_ROLES,
  type AdminUserRow,
  type ErpRole,
  type RoleHolders,
  type VerifiedIdentity,
} from '@erp/types';

import { BREAK_GLASS_EXTERNAL_ID } from './authentication-service';
import { isBreakGlassUsername } from './domain/username';
import type { LdapDirectory } from './providers/ldap-directory';
import type { AuditEventType, AuditSink, Clock, ErpUser, UserRepository } from './ports';

export interface RoleAssignmentInput {
  identity: VerifiedIdentity;
  roles: readonly ErpRole[];
}

export interface AdminContext {
  actor: ErpUser;
  sourceIp?: string;
}

export type SetRolesOutcome =
  { ok: true; user: ErpUser } | { ok: false; reason: 'directory-mismatch' };

export interface AdminRoleServiceOptions {
  users: UserRepository;
  directory: LdapDirectory;
  audit: AuditSink;
  clock: Clock;

  // The reserved break-glass username, the same value AuthenticationService is given.
  breakGlassUsername: string;

  searchLimit?: number;
}

const DEFAULT_SEARCH_LIMIT = 50;

export class AdminRoleService {
  readonly #users: UserRepository;
  readonly #directory: LdapDirectory;
  readonly #audit: AuditSink;
  readonly #clock: Clock;
  readonly #breakGlassUsername: string;
  readonly #limit: number;

  constructor(options: AdminRoleServiceOptions) {
    this.#users = options.users;
    this.#directory = options.directory;
    this.#audit = options.audit;
    this.#clock = options.clock;
    this.#breakGlassUsername = options.breakGlassUsername;
    this.#limit = options.searchLimit ?? DEFAULT_SEARCH_LIMIT;
  }

  async searchUsers(query: string): Promise<readonly AdminUserRow[]> {
    const raw = await this.#directory.searchUsers(query, this.#limit);
    // The break-glass account is not a person and is never offered for role assignment.
    const visible = raw.filter((u) => u.externalId !== BREAK_GLASS_EXTERNAL_ID);

    const rows: AdminUserRow[] = [];
    for (const u of visible) {
      const existing = await this.#users.findByExternalId(u.externalId);
      rows.push({
        externalId: u.externalId,
        username: u.username,
        displayName: u.displayName,
        ...(u.email === undefined ? {} : { email: u.email }),
        disabled: u.disabled,
        roles: existing === null ? [] : [...existing.roles],
        alreadyProvisioned: existing !== null,
      });
    }
    return rows;
  }

  async listRoleHolders(): Promise<readonly RoleHolders[]> {
    const catalog: RoleHolders[] = [];

    for (const role of ERP_ROLES) {
      const holders = await this.#users.listByRole(role);
      catalog.push({
        role,
        holders: holders

          .filter((holder) => holder.externalId !== BREAK_GLASS_EXTERNAL_ID)
          .map((holder) => ({
            externalId: holder.externalId,
            username: holder.username,
            displayName: holder.displayName,
            ...(holder.email === undefined ? {} : { email: holder.email }),
          })),
      });
    }
    return catalog;
  }

  /**
   * Replaces a user's roles and never changes a stored username. For a user who exists it also refreshes
   * the display name and email from the identity in `input`. A user who has never signed in is created
   * from that identity, which is not checked against the directory here, and the first sign-in replaces
   * its username with the directory entry's account name. Refuses with `directory-mismatch` when the
   * identity carries a different external id from the one the route named, when that id is the
   * break-glass account's, or when its username is the reserved break-glass name. Audits a grant and a
   * revoke as separate events.
   */
  async setRolesForUser(
    externalId: string,
    input: RoleAssignmentInput,
    ctx: AdminContext,
  ): Promise<SetRolesOutcome> {
    if (
      input.identity.externalId !== externalId ||
      externalId === BREAK_GLASS_EXTERNAL_ID ||
      isBreakGlassUsername(input.identity.username, this.#breakGlassUsername)
    ) {
      return { ok: false, reason: 'directory-mismatch' };
    }

    const provisioned = await this.#users.upsertKeepingUsername(input.identity);
    const before = new Set(provisioned.roles);
    const desired = [...new Set(input.roles)];
    const after = new Set(desired);
    const updated = await this.#users.setRoles(provisioned.id, desired);
    if (updated === null) {
      return { ok: false, reason: 'directory-mismatch' };
    }

    const added = desired.filter((r) => !before.has(r));
    const removed = [...before].filter((r) => !after.has(r));
    if (added.length > 0) {
      await this.#record('role.granted', updated, ctx, added, removed);
    }
    if (removed.length > 0) {
      await this.#record('role.revoked', updated, ctx, added, removed);
    }

    return { ok: true, user: updated };
  }

  async #record(
    type: AuditEventType,
    target: ErpUser,
    ctx: AdminContext,
    added: readonly ErpRole[],
    removed: readonly ErpRole[],
  ): Promise<void> {
    await this.#audit.record({
      type,
      username: ctx.actor.username,
      at: this.#clock.now(),
      userId: target.id,
      ...(ctx.sourceIp === undefined ? {} : { sourceIp: ctx.sourceIp }),
      detail: [
        `actor=${ctx.actor.username}`,
        `target=${target.username}`,
        `added=${added.length === 0 ? '(none)' : added.join(',')}`,
        `removed=${removed.length === 0 ? '(none)' : removed.join(',')}`,
      ].join(' '),
    });
  }
}
