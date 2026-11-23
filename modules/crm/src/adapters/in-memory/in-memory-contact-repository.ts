// In-memory `ContactRepository` for unit tests and the memory-mode API.
// modules/crm/test/contracts/contact-repository.contract.ts holds it to the Drizzle adapter's behaviour.
import { StaleAggregateError } from '@erp/db';
import { type Contact } from '@erp/types';

import { assignmentsFor, type HeldRole } from '../../contact-roles';
import type { ContactPatch, ContactRepository, ContactRoleRow, NewContactRow } from '../../ports';

interface Row {
  id: string;
  customerId: string;

  name: string | null;
  email: string | null;
  phone: string | null;
  createdAt: Date;
  updatedAt: Date;
  lockVersion: number;

  roles: ContactRoleRow[];
}

export class InMemoryContactRepository implements ContactRepository {
  readonly #byId = new Map<string, Row>();

  constructor(seed: readonly Contact[] = []) {
    for (const c of seed) {
      this.#byId.set(c.id, {
        id: c.id,
        customerId: c.customerId,
        name: c.name,
        email: c.email ?? null,
        phone: c.phone ?? null,
        createdAt: new Date(c.createdAt),
        updatedAt: new Date(c.updatedAt),
        lockVersion: c.lockVersion,
        roles: c.roles.map((role) => ({
          role: role.role,
          setBy: role.setBy,
          setAt: new Date(role.setAt),
        })),
      });
    }
  }

  #heldFor(customerId: string): HeldRole[] {
    const held: HeldRole[] = [];
    for (const row of this.#byId.values()) {
      if (row.customerId !== customerId) continue;
      for (const role of row.roles) {
        held.push({ contactId: row.id, role: role.role, setBy: role.setBy, setAt: role.setAt });
      }
    }
    return held;
  }

  #toContact(row: Row): Contact {
    const held = this.#heldFor(row.customerId);
    return {
      id: row.id,
      customerId: row.customerId,
      name: row.name,
      ...(row.email === null ? {} : { email: row.email }),
      ...(row.phone === null ? {} : { phone: row.phone }),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      lockVersion: row.lockVersion,
      roles: assignmentsFor(held, row.id),
    };
  }

  async create(input: NewContactRow): Promise<Contact> {
    const row: Row = {
      id: input.id,
      customerId: input.customerId,
      name: input.name,
      email: input.email ?? null,
      phone: input.phone ?? null,
      createdAt: input.createdAt,
      updatedAt: input.updatedAt,

      lockVersion: 1,
      roles: [...(input.roles ?? [])],
    };
    this.#byId.set(row.id, row);
    return this.#toContact(row);
  }

  async findById(id: string): Promise<Contact | null> {
    const row = this.#byId.get(id);
    return row === undefined ? null : this.#toContact(row);
  }

  async listByCustomer(customerId: string): Promise<readonly Contact[]> {
    const rows = [...this.#byId.values()].filter((r) => r.customerId === customerId);
    rows.sort((a, b) => byName(a.name, b.name) || a.id.localeCompare(b.id));
    return rows.map((row) => this.#toContact(row));
  }

  async update(
    id: string,
    patch: ContactPatch,
    updatedAt: Date,
    expectedLockVersion: number,
  ): Promise<Contact | null> {
    const existing = this.#byId.get(id);
    if (existing === undefined) {
      return null;
    }

    const hasChange =
      patch.name !== undefined ||
      patch.email !== undefined ||
      patch.phone !== undefined ||
      patch.roles !== undefined;
    if (!hasChange) {
      return this.#toContact(existing);
    }

    if (existing.lockVersion !== expectedLockVersion) {
      throw new StaleAggregateError('contact', id, expectedLockVersion, existing.lockVersion);
    }
    const next: Row = {
      ...existing,
      ...(patch.name === undefined ? {} : { name: patch.name }),

      ...(patch.email === undefined ? {} : { email: patch.email }),
      ...(patch.phone === undefined ? {} : { phone: patch.phone }),
      ...(patch.roles === undefined ? {} : { roles: replaceRoles(existing.roles, patch.roles) }),
      updatedAt,
      lockVersion: existing.lockVersion + 1,
    };
    this.#byId.set(id, next);
    return this.#toContact(next);
  }

  async delete(id: string, expectedLockVersion: number): Promise<boolean> {
    const existing = this.#byId.get(id);
    if (existing === undefined) {
      return false;
    }
    if (existing.lockVersion !== expectedLockVersion) {
      throw new StaleAggregateError('contact', id, expectedLockVersion, existing.lockVersion);
    }

    return this.#byId.delete(id);
  }
}

function byName(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a.localeCompare(b);
}

// A role already held keeps its original `setBy` and `setAt`, as the Drizzle adapter does by
// inserting only the roles that are new.
function replaceRoles(
  current: readonly ContactRoleRow[],
  wanted: readonly ContactRoleRow[],
): ContactRoleRow[] {
  return wanted.map((role) => current.find((held) => held.role === role.role) ?? role);
}
