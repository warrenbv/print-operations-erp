// Customer names and records for lists that hold only customer ids, read from the crm API.
import {
  customerSchema,
  customerSearchResponseSchema,
  CUSTOMER_SEARCH_MAX_LIMIT,
  type Customer,
} from '@erp/types';

import { fetchParsed } from '../../lib/fetch-parsed';

export const UNKNOWN_CUSTOMER = '(unknown customer)';

/** Names by id. An id the API does not return reads as `UNKNOWN_CUSTOMER` instead of failing the page. */
export async function loadCustomerNames(
  ids: readonly string[],
): Promise<ReadonlyMap<string, string>> {
  const names = new Map([...new Set(ids)].map((id) => [id, UNKNOWN_CUSTOMER]));
  for (const [id, customer] of await loadCustomerRecords(ids)) {
    names.set(id, customer.name);
  }
  return names;
}

export async function loadCustomerRecords(
  ids: readonly string[],
): Promise<ReadonlyMap<string, Customer>> {
  const unique = [...new Set(ids)];
  const found = new Map<string, Customer>();
  if (unique.length === 0) return found;

  // The search route refuses more than `CUSTOMER_SEARCH_MAX_LIMIT` ids in one request, so the ids
  // go in batches of that size.
  const batches: string[][] = [];
  for (let i = 0; i < unique.length; i += CUSTOMER_SEARCH_MAX_LIMIT) {
    batches.push(unique.slice(i, i + CUSTOMER_SEARCH_MAX_LIMIT));
  }

  const pages = await Promise.all(
    batches.map((batch) =>
      fetchParsed(
        `/crm/customers?ids=${encodeURIComponent(batch.join(','))}`,
        customerSearchResponseSchema,
      ),
    ),
  );

  for (const page of pages) {
    for (const customer of page.items) {
      found.set(customer.id, customer);
    }
  }
  return found;
}

export async function loadCustomerName(id: string): Promise<string> {
  const customer = await fetchParsed(`/crm/customers/${encodeURIComponent(id)}`, customerSchema, {
    notFound: 'null',
  });
  return customer === null ? UNKNOWN_CUSTOMER : customer.name;
}
