// Reads the references of the quotes that name orders still without a job number, in batches the quote list read accepts.
import { CUSTOMER_SEARCH_MAX_LIMIT, quoteListResponseSchema, quoteReference } from '@erp/types';

import { fetchParsed } from '../../lib/fetch-parsed';

export function quoteIdsToName(
  orders: readonly { readonly quoteId: string; readonly jobNumber?: string | undefined }[],
): string[] {
  return [
    ...new Set(orders.filter((order) => order.jobNumber === undefined).map((o) => o.quoteId)),
  ];
}

export async function loadQuoteReferences(
  orders: readonly { readonly quoteId: string; readonly jobNumber?: string | undefined }[],
): Promise<ReadonlyMap<string, string>> {
  const ids = quoteIdsToName(orders);
  const chunks: string[][] = [];
  for (let start = 0; start < ids.length; start += CUSTOMER_SEARCH_MAX_LIMIT) {
    chunks.push(ids.slice(start, start + CUSTOMER_SEARCH_MAX_LIMIT));
  }
  const reads = await Promise.all(
    chunks.map((chunk) =>
      fetchParsed(
        `/quoting/quotes?${chunk.map((id) => `id=${encodeURIComponent(id)}`).join('&')}`,
        quoteListResponseSchema,
      ),
    ),
  );
  const references = new Map<string, string>();
  for (const { items } of reads) {
    for (const quote of items) references.set(quote.id, quoteReference(quote));
  }
  return references;
}
