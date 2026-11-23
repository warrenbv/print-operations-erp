// The addresses a document goes to: the customer's contacts tagged for that document.
// A quote goes only to contacts tagged for quotes: docs/product/requirements.md (R1).
// The selection is `recipientAddressesFor` in packages/types/src/contact.ts.
import { contactListResponseSchema, recipientAddressesFor, type MailContactRole } from '@erp/types';

import { fetchParsed } from './fetch-parsed';

export async function loadRecipientsForRole(
  customerId: string,
  role: MailContactRole,
): Promise<readonly string[]> {
  const { items } = await fetchParsed(
    `/crm/customers/${encodeURIComponent(customerId)}/contacts`,
    contactListResponseSchema,
  );
  return recipientAddressesFor(items, role);
}
