// Loads the customer names behind the suggestion datalist, and jumps straight to a customer when the typed name
// matches exactly one of them. The datalist is apps/web/src/lib/customer-suggestion-list.tsx.
import { customerNameListResponseSchema, type CustomerName } from '@erp/types';
import { redirect } from 'next/navigation';

import { fetchParsed } from './fetch-parsed';

export const CUSTOMER_LIST_ID = 'customer-suggestions';

export async function loadCustomerSuggestions(): Promise<{
  items: readonly CustomerName[];
  total: number;
}> {
  const { items, total } = await fetchParsed(
    '/crm/customers/names',
    customerNameListResponseSchema,
  );
  return { items, total };
}

export function exactlyOneNamed(
  suggestions: readonly CustomerName[],
  typed: string,
): CustomerName | undefined {
  const needle = typed.trim().toLowerCase();
  if (needle === '') {
    return undefined;
  }
  const matches = suggestions.filter((c) => c.name.toLowerCase() === needle);
  return matches.length === 1 ? matches[0] : undefined;
}

/**
 * Redirects when exactly one suggestion carries the typed name, ignoring case. Otherwise it returns.
 * `redirect` works by throwing, so do not call this inside a try block that catches everything.
 */
export function jumpToExactCustomer(
  suggestions: readonly CustomerName[],
  typed: string,
  to: (customer: CustomerName) => string,
): void {
  const found = exactlyOneNamed(suggestions, typed);
  if (found !== undefined) {
    redirect(to(found));
  }
}
