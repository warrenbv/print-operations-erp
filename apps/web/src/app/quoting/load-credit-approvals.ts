// Loads a customer's credit-hold exception requests from the quoting API: docs/product/requirements.md (R2).
import { quoteApprovalListResponseSchema, type QuoteApproval } from '@erp/types';

import { fetchParsed } from '../../lib/fetch-parsed';

export async function loadCreditApprovals(customerId: string): Promise<QuoteApproval[]> {
  const { items } = await fetchParsed(
    `/quoting/credit-approvals?customerId=${encodeURIComponent(customerId)}`,
    quoteApprovalListResponseSchema,
  );
  return [...items];
}

export async function loadCreditApprovalsFor(
  customerIds: readonly string[],
): Promise<ReadonlyMap<string, QuoteApproval[]>> {
  const unique = [...new Set(customerIds)];
  const entries = await Promise.all(
    unique.map(async (id): Promise<readonly [string, QuoteApproval[]]> => [
      id,
      await loadCreditApprovals(id),
    ]),
  );
  return new Map(entries);
}
