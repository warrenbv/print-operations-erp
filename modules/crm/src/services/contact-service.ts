// Contacts and the roles that decide who receives each kind of mail.
// A quote goes only to contacts tagged `quote`: docs/product/requirements.md (R1).
// The reach each role needs is in modules/crm/src/contact-roles.ts.
import { newId } from '@erp/db';
import { MAIL_CONTACT_ROLES, isMailContactRole } from '@erp/types';
import type {
  Contact,
  ContactListResponse,
  ContactRole,
  CreateContactRequest,
  UpdateContactRequest,
} from '@erp/types';

import { reachOf, sortRoleNames, supportsRole } from '../contact-roles';
import type {
  Clock,
  ContactPatch,
  ContactRepository,
  ContactRoleRow,
  CustomerRepository,
  NewContactRow,
} from '../ports';

/** Recorded as `setBy` on the mail roles given automatically to a customer's first emailable contact. */
export const AUTOMATIC_RECIPIENT_ACTOR = 'system:first-contact';

export interface ContactServiceOptions {
  contacts: ContactRepository;
  customers: CustomerRepository;
  clock: Clock;
}

export type ContactWriteResult =
  | { ok: true; contact: Contact }
  | {
      ok: false;
      reason:
        | 'customer-not-found'
        | 'contact-not-found'
        | 'wrong-customer'
        | 'contact-needs-name-or-email';
    };

export type ContactUpdateResult =
  | { ok: true; contact: Contact; rolesGivenUp: readonly ContactRole[] }
  | { ok: false; reason: 'contact-not-found' | 'wrong-customer' }
  | { ok: false; reason: 'contact-role-unreachable'; roles: readonly ContactRole[] }
  | { ok: false; reason: 'contact-needs-name-or-email' };

export type ContactDeleteResult =
  { ok: true } | { ok: false; reason: 'contact-not-found' | 'wrong-customer' };

export class ContactService {
  readonly #contacts: ContactRepository;
  readonly #customers: CustomerRepository;
  readonly #clock: Clock;

  constructor(options: ContactServiceOptions) {
    this.#contacts = options.contacts;
    this.#customers = options.customers;
    this.#clock = options.clock;
  }

  async create(customerId: string, request: CreateContactRequest): Promise<ContactWriteResult> {
    // The rule of contacts_name_or_email_check, checked first so the API can answer with a reason.
    if (request.name === undefined && request.email === undefined) {
      return { ok: false, reason: 'contact-needs-name-or-email' };
    }
    const customer = await this.#customers.findById(customerId);
    if (customer === null) {
      return { ok: false, reason: 'customer-not-found' };
    }
    const now = this.#clock.now();
    const held = await this.#contacts.listByCustomer(customerId);

    // A contact with an email address takes every mail role while no contact of this customer
    // holds one. Roles already held elsewhere are never moved.
    const receivesDocuments =
      request.email !== undefined &&
      !held.some((c) => c.roles.some((role) => isMailContactRole(role.role)));
    const input: NewContactRow = {
      id: newId(),
      customerId,
      name: request.name ?? null,
      createdAt: now,
      updatedAt: now,
      ...(request.email === undefined ? {} : { email: request.email }),
      ...(request.phone === undefined ? {} : { phone: request.phone }),
      ...(receivesDocuments
        ? {
            roles: MAIL_CONTACT_ROLES.map((role) => ({
              role,
              setBy: AUTOMATIC_RECIPIENT_ACTOR,
              setAt: now,
            })),
          }
        : {}),
    };
    return { ok: true, contact: await this.#contacts.create(input) };
  }

  async listByCustomer(customerId: string): Promise<ContactListResponse | null> {
    const customer = await this.#customers.findById(customerId);
    if (customer === null) {
      return null;
    }
    const items = await this.#contacts.listByCustomer(customerId);
    return { items: [...items] };
  }

  async update(
    customerId: string,
    contactId: string,
    patch: UpdateContactRequest,
    actor: string,
  ): Promise<ContactUpdateResult> {
    const existing = await this.#contacts.findById(contactId);
    if (existing === null) {
      return { ok: false, reason: 'contact-not-found' };
    }
    if (existing.customerId !== customerId) {
      return { ok: false, reason: 'wrong-customer' };
    }

    const nameAfter = patch.name === undefined ? existing.name : patch.name;
    const emailAfter = patch.email === undefined ? existing.email : patch.email;
    if (nameAfter === null && (emailAfter === null || emailAfter === undefined)) {
      return { ok: false, reason: 'contact-needs-name-or-email' };
    }

    const heldRoles = new Set(existing.roles.map((role) => role.role));

    const requested = new Set(patch.roles ?? [...heldRoles]);

    const reach = reachOf(
      patch.email === undefined ? existing.email : patch.email,
      patch.phone === undefined ? existing.phone : patch.phone,
    );
    // A role the patch adds but the contact cannot be reached for is refused. A held role the patch
    // makes unreachable is given up instead and named in `rolesGivenUp`, so the screen can say so.
    const unsupported = [...requested].filter((role) => !supportsRole(reach, role));
    const refused = sortRoleNames(unsupported.filter((role) => !heldRoles.has(role)));
    if (refused.length > 0) {
      return { ok: false, reason: 'contact-role-unreachable', roles: refused };
    }
    const rolesGivenUp = sortRoleNames(unsupported.filter((role) => heldRoles.has(role)));
    const now = this.#clock.now();
    const roles: ContactRoleRow[] = sortRoleNames(
      [...requested].filter((role) => supportsRole(reach, role)),
    ).map((role) => {
      const prior = existing.roles.find((assignment) => assignment.role === role);
      return prior === undefined
        ? { role, setBy: actor, setAt: now }
        : { role, setBy: prior.setBy, setAt: new Date(prior.setAt) };
    });

    const writeRoles = patch.roles !== undefined || rolesGivenUp.length > 0;
    const storePatch: ContactPatch = {
      ...(patch.name === undefined ? {} : { name: patch.name }),
      ...(patch.email === undefined ? {} : { email: patch.email }),
      ...(patch.phone === undefined ? {} : { phone: patch.phone }),
      ...(writeRoles ? { roles } : {}),
    };

    const updated = await this.#contacts.update(contactId, storePatch, now, patch.lockVersion);
    if (updated === null) {
      return { ok: false, reason: 'contact-not-found' };
    }
    return { ok: true, contact: updated, rolesGivenUp };
  }

  async delete(
    customerId: string,
    contactId: string,
    expectedLockVersion: number,
  ): Promise<ContactDeleteResult> {
    const existing = await this.#contacts.findById(contactId);
    if (existing === null) {
      return { ok: false, reason: 'contact-not-found' };
    }
    if (existing.customerId !== customerId) {
      return { ok: false, reason: 'wrong-customer' };
    }
    const removed = await this.#contacts.delete(contactId, expectedLockVersion);
    if (!removed) {
      return { ok: false, reason: 'contact-not-found' };
    }
    return { ok: true };
  }
}
