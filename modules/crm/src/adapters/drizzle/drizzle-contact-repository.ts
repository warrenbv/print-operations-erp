// PostgreSQL `ContactRepository` over crm.contacts and crm.contact_roles.
// A contact and its roles are one aggregate with one lockVersion: docs/decisions/006-optimistic-concurrency.md.
import { StaleAggregateError, isForeignKeyViolation } from '@erp/db';
import { type Contact, type ContactRole } from '@erp/types';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';

import { assignmentsFor, reachOf, type HeldRole } from '../../contact-roles';
import type { CrmDb } from '../../data/crm-db';
import { contactRoles, contacts } from '../../data/schema';
import {
  ContactCustomerNotFoundError,
  type ContactPatch,
  type ContactRepository,
  type ContactRoleRow,
  type NewContactRow,
} from '../../ports';

type Row = typeof contacts.$inferSelect;

function toContact(row: Row, held: readonly HeldRole[]): Contact {
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

// Drizzle types the generated column as nullable. The fallback derives the same value.
function reachOfRow(row: Row): string {
  return row.contactReach ?? reachOf(row.email, row.phone);
}

async function staleOrMissing(db: CrmDb, id: string, expectedLockVersion: number): Promise<null> {
  const [current] = await db.select().from(contacts).where(eq(contacts.id, id)).limit(1);
  if (current !== undefined) {
    throw new StaleAggregateError('contact', id, expectedLockVersion, current.lockVersion);
  }
  return null;
}

async function heldFor(db: CrmDb, customerId: string): Promise<HeldRole[]> {
  const rows = await db
    .select({
      contactId: contactRoles.contactId,
      role: contactRoles.role,
      setBy: contactRoles.setBy,
      setAt: contactRoles.setAt,
    })
    .from(contactRoles)
    .innerJoin(contacts, eq(contactRoles.contactId, contacts.id))
    .where(eq(contacts.customerId, customerId));

  return rows.map((row) => ({ ...row, role: row.role as ContactRole }));
}

function roleValues(
  contactId: string,
  reach: string,
  roles: readonly ContactRoleRow[],
): { contactId: string; role: string; contactReach: string; setBy: string; setAt: Date }[] {
  return roles.map((role) => ({
    contactId,
    role: role.role,
    contactReach: reach,
    setBy: role.setBy,
    setAt: role.setAt,
  }));
}

export class DrizzleContactRepository implements ContactRepository {
  readonly #db: CrmDb;

  constructor(db: CrmDb) {
    this.#db = db;
  }

  async create(input: NewContactRow): Promise<Contact> {
    try {
      return await this.#db.transaction(async (tx) => {
        const [row] = await tx
          .insert(contacts)
          .values({
            id: input.id,
            customerId: input.customerId,
            name: input.name,
            email: input.email ?? null,
            phone: input.phone ?? null,
            createdAt: input.createdAt,
            updatedAt: input.updatedAt,
          })
          .returning();
        if (row === undefined) {
          throw new Error('Creating a contact returned no row');
        }
        if (input.roles !== undefined && input.roles.length > 0) {
          await tx.insert(contactRoles).values(roleValues(row.id, reachOfRow(row), input.roles));
        }
        return toContact(row, await heldFor(tx, row.customerId));
      });
    } catch (err) {
      if (isForeignKeyViolation(err)) {
        throw new ContactCustomerNotFoundError(input.customerId);
      }
      throw err;
    }
  }

  async findById(id: string): Promise<Contact | null> {
    const [row] = await this.#db.select().from(contacts).where(eq(contacts.id, id)).limit(1);
    if (row === undefined) {
      return null;
    }
    return toContact(row, await heldFor(this.#db, row.customerId));
  }

  async listByCustomer(customerId: string): Promise<readonly Contact[]> {
    const rows = await this.#db
      .select()
      .from(contacts)
      .where(eq(contacts.customerId, customerId))

      .orderBy(asc(contacts.name), asc(contacts.id));
    const held = await heldFor(this.#db, customerId);
    return rows.map((row) => toContact(row, held));
  }

  async update(
    id: string,
    patch: ContactPatch,
    updatedAt: Date,
    expectedLockVersion: number,
  ): Promise<Contact | null> {
    const hasChange =
      patch.name !== undefined ||
      patch.email !== undefined ||
      patch.phone !== undefined ||
      patch.roles !== undefined;
    if (!hasChange) {
      return this.findById(id);
    }

    return this.#db.transaction(async (tx) => {
      const current =
        patch.roles === undefined
          ? []
          : await tx
              .select({ role: contactRoles.role })
              .from(contactRoles)
              .where(eq(contactRoles.contactId, id));
      // Roles that are going are deleted before the contact row changes. A new email or phone moves
      // the generated contact_reach, the foreign key cascades it into every role row, and a mail
      // role left behind would fail contact_roles_reachable_check.
      const wanted = new Set(patch.roles?.map((role) => role.role) ?? []);
      const gone = current
        .map((row) => row.role)
        .filter((role) => !wanted.has(role as ContactRole));
      if (gone.length > 0) {
        await tx
          .delete(contactRoles)
          .where(and(eq(contactRoles.contactId, id), inArray(contactRoles.role, gone)));
      }

      const [row] = await tx
        .update(contacts)
        .set({
          ...(patch.name === undefined ? {} : { name: patch.name }),

          ...(patch.email === undefined ? {} : { email: patch.email }),
          ...(patch.phone === undefined ? {} : { phone: patch.phone }),
          updatedAt,
          lockVersion: sql`${contacts.lockVersion} + 1`,
        })

        .where(and(eq(contacts.id, id), eq(contacts.lockVersion, expectedLockVersion)))
        .returning();
      if (row === undefined) {
        return await staleOrMissing(tx, id, expectedLockVersion);
      }

      // New roles go in after the update so they carry the reach the update produced.
      if (patch.roles !== undefined) {
        const kept = new Set(current.map((held) => held.role));
        const added = patch.roles.filter((role) => !kept.has(role.role));
        if (added.length > 0) {
          await tx.insert(contactRoles).values(roleValues(id, reachOfRow(row), added));
        }
      }

      return toContact(row, await heldFor(tx, row.customerId));
    });
  }

  async delete(id: string, expectedLockVersion: number): Promise<boolean> {
    const [row] = await this.#db
      .delete(contacts)

      .where(and(eq(contacts.id, id), eq(contacts.lockVersion, expectedLockVersion)))
      .returning({ id: contacts.id });
    if (row === undefined) {
      await staleOrMissing(this.#db, id, expectedLockVersion);
      return false;
    }
    return true;
  }
}
