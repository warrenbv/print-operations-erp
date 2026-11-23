// The addresses of a customer's contacts tagged for one mail role. A quote goes only to its `quote` contacts: docs/product/requirements.md (R1).
// Order confirmations use `order_confirmation`. The tagging rule is `recipientAddressesFor` in packages/types/src/contact.ts.
import type { ContactService } from '@erp/crm';
import { recipientAddressesFor, type MailContactRole } from '@erp/types';

export async function recipientsForRole(
  contacts: ContactService,
  customerId: string,
  role: MailContactRole,
): Promise<readonly string[]> {
  const found = await contacts.listByCustomer(customerId);
  return recipientAddressesFor(found?.items ?? [], role);
}
