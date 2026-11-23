// The customer's contacts tagged Production, and how one prints on the order page.
import { contactListResponseSchema, type Contact } from '@erp/types';

import { contactLine } from './contact-line';
import { fetchParsed } from './fetch-parsed';

export function productionContacts(contacts: readonly Contact[]): readonly Contact[] {
  return contacts.filter((contact) =>
    contact.roles.some((assignment) => assignment.role === 'production'),
  );
}

export function productionContactWords(contact: Contact): string {
  const line = contactLine(contact);
  return [line.label, contact.phone, line.email]
    .filter((part): part is string => part !== undefined)
    .join(' · ');
}

export async function loadProductionContacts(customerId: string): Promise<readonly Contact[]> {
  const { items } = await fetchParsed(
    `/crm/customers/${encodeURIComponent(customerId)}/contacts`,
    contactListResponseSchema,
  );
  return productionContacts(items);
}
