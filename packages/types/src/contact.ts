// Customer contacts and the tags that decide which messages each one receives.
// `CONTACT_ROLES` is mirrored by `contact_roles_role_check` in infra/db/migrations/crm/0000_baseline.sql.
// The API resolves recipients through apps/api/src/crm/recipients-for-role.ts.
import { z } from 'zod';

import { customerIdSchema } from './customer';

const trimmedName = z.string().trim().min(1).max(255);

export const CONTACT_NEEDS_NAME_OR_EMAIL = 'a contact needs a name or an email address.';

const phone = z.string().trim().min(1).max(64);

export const contactIdSchema = z.string().min(1);

export const contactEmailSchema = z.email();

export const CONTACT_ROLES = ['quote', 'order_confirmation', 'production'] as const;

export const contactRoleSchema = z.enum(CONTACT_ROLES);

export type ContactRole = z.infer<typeof contactRoleSchema>;

// The tags that receive email. A production contact may be reachable by phone alone, which
// `contact_roles_reachable_check` in infra/db/migrations/crm/0000_baseline.sql allows.
export const MAIL_CONTACT_ROLES = ['quote', 'order_confirmation'] as const;

export type MailContactRole = (typeof MAIL_CONTACT_ROLES)[number];

export function isMailContactRole(role: ContactRole): role is MailContactRole {
  return (MAIL_CONTACT_ROLES as readonly string[]).includes(role);
}

export const contactRoleAssignmentSchema = z.object({
  role: contactRoleSchema,

  setBy: z.string().trim().min(1).max(128),
  setAt: z.iso.datetime(),
});

export type ContactRoleAssignment = z.infer<typeof contactRoleAssignmentSchema>;

export const contactSchema = z.object({
  id: contactIdSchema,
  customerId: customerIdSchema,

  name: trimmedName.nullable(),
  email: contactEmailSchema.optional(),
  phone: phone.optional(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),

  lockVersion: z.number().int().min(1),

  roles: z.array(contactRoleAssignmentSchema),
});

export type Contact = z.infer<typeof contactSchema>;

export const createContactRequestSchema = z
  .object({
    name: trimmedName.optional(),
    email: contactEmailSchema.optional(),
    phone: phone.optional(),
  })
  .refine((request) => request.name !== undefined || request.email !== undefined, {
    error: CONTACT_NEEDS_NAME_OR_EMAIL,
  });

export type CreateContactRequest = z.infer<typeof createContactRequestSchema>;

export const updateContactRequestSchema = z.object({
  name: trimmedName.nullable().optional(),
  email: contactEmailSchema.nullable().optional(),
  phone: phone.nullable().optional(),

  roles: z.array(contactRoleSchema).optional(),

  lockVersion: z.number().int().min(1),
});

export type UpdateContactRequest = z.infer<typeof updateContactRequestSchema>;

export const updateContactResponseSchema = contactSchema.extend({
  rolesGivenUp: z.array(contactRoleSchema),
});

export type UpdateContactResponse = z.infer<typeof updateContactResponseSchema>;

export const deleteContactRequestSchema = z.object({
  lockVersion: z.number().int().min(1),
});

export type DeleteContactRequest = z.infer<typeof deleteContactRequestSchema>;

export const contactListResponseSchema = z.object({
  items: z.array(contactSchema),
});

export type ContactListResponse = z.infer<typeof contactListResponseSchema>;

export function normaliseEmailAddress(address: string): string {
  return address.trim().toLowerCase();
}

/**
 * The addresses a message for `role` goes to: tagged contacts with an email, lower-cased,
 * de-duplicated and sorted. A quote goes only to contacts tagged for quotes, and with none it
 * cannot be sent: docs/product/requirements.md (R1).
 */
export function recipientAddressesFor(
  contacts: readonly Contact[],
  role: MailContactRole,
): string[] {
  const addresses = new Set<string>();
  for (const contact of contacts) {
    if (contact.email === undefined) continue;
    if (!contact.roles.some((assignment) => assignment.role === role)) continue;
    addresses.add(normaliseEmailAddress(contact.email));
  }
  return [...addresses].sort();
}

export function contactLabel(contact: Pick<Contact, 'name' | 'email'>): string {
  return contact.name ?? contact.email ?? '';
}

export const confirmRecipientRequestSchema = z.object({
  confirmRecipients: z.array(z.email()).optional(),
});

export type ConfirmRecipientRequest = z.infer<typeof confirmRecipientRequestSchema>;
