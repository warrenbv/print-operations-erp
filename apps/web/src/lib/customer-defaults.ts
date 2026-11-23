// Reads a customer's quote defaults. A customer with none saved gets the empty defaults instead of a 404,
// so the pages render the same either way. The shape is packages/types/src/customer-defaults.ts.
import { customerDefaultsSchema, emptyCustomerDefaults, type CustomerDefaults } from '@erp/types';

import { fetchParsed } from './fetch-parsed';

export async function loadCustomerDefaults(customerId: string): Promise<CustomerDefaults> {
  const found = await fetchParsed(
    `/crm/customers/${encodeURIComponent(customerId)}/defaults`,
    customerDefaultsSchema,
    { notFound: 'null' },
  );
  return found ?? emptyCustomerDefaults(customerId);
}
