// The `UserRepository` in PostgreSQL, keyed by the directory's external id. The in-memory counterpart
// is modules/identity/src/adapters/in-memory/in-memory-user-repository.ts.
import { newId } from '@erp/db';
import { isErpRole, type ErpRole, type VerifiedIdentity } from '@erp/types';
import { asc, desc, eq, inArray, sql } from 'drizzle-orm';

import type { IdentityDb } from '../../data/identity-db';
import { users } from '../../data/schema';
import type { ErpUser, UserRepository } from '../../ports';

type UserRow = typeof users.$inferSelect;

function toErpUser(row: UserRow): ErpUser {
  return {
    id: row.id,
    externalId: row.externalId,
    username: row.username,
    displayName: row.displayName,
    ...(row.email === null ? {} : { email: row.email }),

    // The column is free text. A stored value that is not a current role is dropped on read.
    roles: row.roles.filter(isErpRole),
  };
}

export class DrizzleUserRepository implements UserRepository {
  readonly #db: IdentityDb;

  constructor(db: IdentityDb) {
    this.#db = db;
  }

  async upsertFromIdentity(identity: VerifiedIdentity): Promise<ErpUser> {
    const [row] = await this.#db
      .insert(users)
      .values({
        id: newId(),
        externalId: identity.externalId,
        username: identity.username,
        displayName: identity.displayName,
        email: identity.email ?? null,
        roles: [],
      })
      .onConflictDoUpdate({
        target: users.externalId,
        set: {
          username: identity.username,
          displayName: identity.displayName,
          email: identity.email ?? null,

          // Roles are left out on purpose. A sign-in refreshes what the directory owns and never the roles.
          updatedAt: sql`now()`,
        },
      })
      .returning();

    if (row === undefined) {
      throw new Error(`Upserting user "${identity.externalId}" returned no row`);
    }
    return toErpUser(row);
  }

  async upsertKeepingUsername(identity: VerifiedIdentity): Promise<ErpUser> {
    const [row] = await this.#db
      .insert(users)
      .values({
        id: newId(),
        externalId: identity.externalId,
        username: identity.username,
        displayName: identity.displayName,
        email: identity.email ?? null,
        roles: [],
      })
      .onConflictDoUpdate({
        target: users.externalId,
        set: {
          // The username is left out on purpose. The read-only rule matches it, so only a sign-in changes it.
          displayName: identity.displayName,
          email: identity.email ?? null,
          updatedAt: sql`now()`,
        },
      })
      .returning();

    if (row === undefined) {
      throw new Error(`Upserting user "${identity.externalId}" returned no row`);
    }
    return toErpUser(row);
  }

  async findById(id: string): Promise<ErpUser | null> {
    const [row] = await this.#db.select().from(users).where(eq(users.id, id)).limit(1);
    return row === undefined ? null : toErpUser(row);
  }

  async findByExternalId(externalId: string): Promise<ErpUser | null> {
    const [row] = await this.#db
      .select()
      .from(users)
      .where(eq(users.externalId, externalId))
      .limit(1);
    return row === undefined ? null : toErpUser(row);
  }

  async findByUsername(username: string): Promise<ErpUser | null> {
    const [row] = await this.#db
      .select()
      .from(users)
      .where(eq(users.username, username))
      .orderBy(desc(users.updatedAt))
      .limit(1);
    return row === undefined ? null : toErpUser(row);
  }

  async findByUsernames(usernames: readonly string[]): Promise<readonly ErpUser[]> {
    const wanted = [...new Set(usernames)];
    if (wanted.length === 0) {
      return [];
    }
    const rows = await this.#db
      .select()
      .from(users)
      .where(inArray(users.username, wanted))

      .orderBy(asc(users.username), desc(users.updatedAt));

    const holders = new Map<string, UserRow>();
    for (const row of rows) {
      if (!holders.has(row.username)) {
        holders.set(row.username, row);
      }
    }
    return [...holders.values()].map(toErpUser);
  }

  async setRoles(id: string, roles: readonly ErpRole[]): Promise<ErpUser | null> {
    const deduped = [...new Set(roles)];
    const [row] = await this.#db
      .update(users)
      .set({ roles: deduped, updatedAt: sql`now()` })
      .where(eq(users.id, id))
      .returning();
    return row === undefined ? null : toErpUser(row);
  }

  async listByRole(role: ErpRole): Promise<readonly ErpUser[]> {
    const rows = await this.#db
      .select()
      .from(users)
      .where(sql`${users.roles} @> ARRAY[${role}]::text[]`)
      .orderBy(asc(users.username));
    return rows.map(toErpUser);
  }
}
