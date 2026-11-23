// The `UserRepository` in memory. The PostgreSQL counterpart is
// modules/identity/src/adapters/drizzle/drizzle-user-repository.ts.
import { randomUUID } from 'node:crypto';

import type { ErpRole, VerifiedIdentity } from '@erp/types';

import type { ErpUser, UserRepository } from '../../ports';

export class InMemoryUserRepository implements UserRepository {
  readonly #byExternalId = new Map<string, ErpUser>();
  readonly #byId = new Map<string, ErpUser>();

  // Stands in for the PostgreSQL adapter's `updated_at`, so both pick the most recently written row
  // when two share a username.
  readonly #writeOrder = new Map<string, number>();
  #writes = 0;

  constructor(seed: readonly ErpUser[] = []) {
    for (const user of seed) {
      this.#put(user);
    }
  }

  async upsertFromIdentity(identity: VerifiedIdentity): Promise<ErpUser> {
    const existing = this.#byExternalId.get(identity.externalId);

    const user: ErpUser = {
      id: existing?.id ?? randomUUID(),
      externalId: identity.externalId,
      username: identity.username,
      displayName: identity.displayName,
      ...(identity.email === undefined ? {} : { email: identity.email }),
      roles: existing?.roles ?? [],
    };
    this.#put(user);
    return user;
  }

  async upsertKeepingUsername(identity: VerifiedIdentity): Promise<ErpUser> {
    const existing = this.#byExternalId.get(identity.externalId);

    const user: ErpUser = {
      id: existing?.id ?? randomUUID(),
      externalId: identity.externalId,
      username: existing?.username ?? identity.username,
      displayName: identity.displayName,
      ...(identity.email === undefined ? {} : { email: identity.email }),
      roles: existing?.roles ?? [],
    };
    this.#put(user);
    return user;
  }

  async findById(id: string): Promise<ErpUser | null> {
    return this.#byId.get(id) ?? null;
  }

  async findByExternalId(externalId: string): Promise<ErpUser | null> {
    return this.#byExternalId.get(externalId) ?? null;
  }

  async findByUsername(username: string): Promise<ErpUser | null> {
    const holders = [...this.#byId.values()]
      .filter((user) => user.username === username)
      .sort((a, b) => this.#written(b) - this.#written(a));
    return holders[0] ?? null;
  }

  async findByUsernames(usernames: readonly string[]): Promise<readonly ErpUser[]> {
    const wanted = new Set(usernames);
    const holders = new Map<string, ErpUser>();
    for (const user of this.#byId.values()) {
      if (!wanted.has(user.username)) {
        continue;
      }
      const incumbent = holders.get(user.username);

      if (incumbent === undefined || this.#written(user) > this.#written(incumbent)) {
        holders.set(user.username, user);
      }
    }
    return [...holders.values()].sort((a, b) => a.username.localeCompare(b.username));
  }

  async setRoles(id: string, roles: readonly ErpRole[]): Promise<ErpUser | null> {
    const existing = this.#byId.get(id);
    if (existing === undefined) {
      return null;
    }

    const deduped: readonly ErpRole[] = [...new Set(roles)];
    const next: ErpUser = { ...existing, roles: deduped };
    this.#put(next);
    return next;
  }

  async listByRole(role: ErpRole): Promise<readonly ErpUser[]> {
    return [...this.#byId.values()]
      .filter((user) => user.roles.includes(role))
      .sort((a, b) => a.username.localeCompare(b.username));
  }

  #written(user: ErpUser): number {
    return this.#writeOrder.get(user.id) ?? 0;
  }

  #put(user: ErpUser): void {
    this.#byExternalId.set(user.externalId, user);
    this.#byId.set(user.id, user);
    this.#writes += 1;
    this.#writeOrder.set(user.id, this.#writes);
  }
}
