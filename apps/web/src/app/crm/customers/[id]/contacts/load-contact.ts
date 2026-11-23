// Finds one contact in its customer's contact list. 'not-found' covers a missing customer and a missing contact.
import { contactListResponseSchema, type Contact } from '@erp/types';

import { fetchParsed } from '../../../../../lib/fetch-parsed';

export async function loadContact(
  customerId: string,
  contactId: string,
): Promise<Contact | 'not-found'> {
  const list = await fetchParsed(
    `/crm/customers/${encodeURIComponent(customerId)}/contacts`,
    contactListResponseSchema,
    { notFound: 'null' },
  );
  if (list === null) return 'not-found';
  return list.items.find((contact) => contact.id === contactId) ?? 'not-found';
}
