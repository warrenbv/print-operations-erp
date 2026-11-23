// The customer search on New quote. A blank search shows a prompt and fetches nothing.
import { customerSearchResponseSchema, type Customer } from '@erp/types';

import { fetchParsed } from '../../../../lib/fetch-parsed';
import { showingLine, type Paging } from '../../../../lib/paging';

export const SEARCH_FIRST_SENTENCE = "Type part of a customer's name to find them.";

export const DIRECTORY_HREF = '/crm/customers';

export const DIRECTORY_LINK_LABEL = 'Open the customer directory';

export type CustomerStep =
  | { kind: 'prompt' }
  | {
      kind: 'results';
      customers: Customer[];
      total: number;

      showing: string | null;
    };

export async function loadCustomerStep(q: string, paging: Paging): Promise<CustomerStep> {
  const term = q.trim();
  if (term === '') {
    return { kind: 'prompt' };
  }
  const { items, total } = await fetchParsed(
    `/crm/customers?q=${encodeURIComponent(term)}&limit=${String(paging.size)}&offset=${String(paging.offset)}`,
    customerSearchResponseSchema,
  );
  return {
    kind: 'results',
    customers: [...items],
    total,
    showing: showingLine(paging, total, items.length),
  };
}
