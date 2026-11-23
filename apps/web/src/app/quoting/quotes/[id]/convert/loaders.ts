// Reads for the convert page: the quote, and what its orders already hold of each line.
import {
  ORDER_TOTALS_LOOKUP_MAX_IDS,
  orderLinesLookupResponseSchema,
  orderListResponseSchema,
  quoteWithLinesSchema,
  type OrderLine,
  type QuoteWithLines,
} from '@erp/types';

import { fetchParsed } from '../../../../../lib/fetch-parsed';
import { orderedSoFar, type SoFar } from './convert-grid';

export async function loadQuote(id: string): Promise<QuoteWithLines | null> {
  return fetchParsed(`/quoting/quotes/${encodeURIComponent(id)}`, quoteWithLinesSchema, {
    notFound: 'null',
  });
}

export async function loadOrderedSoFar(quoteId: string): Promise<ReadonlyMap<string, SoFar>> {
  const { items: orders } = await fetchParsed(
    `/orders?quoteId=${encodeURIComponent(quoteId)}`,
    orderListResponseSchema,
  );
  return orderedSoFar(orders, await loadOrderLines(orders.map((order) => order.id)));
}

export async function loadOrderLines(
  ids: readonly string[],
): Promise<ReadonlyMap<string, readonly OrderLine[]>> {
  const batches: string[][] = [];
  for (let i = 0; i < ids.length; i += ORDER_TOTALS_LOOKUP_MAX_IDS) {
    batches.push(ids.slice(i, i + ORDER_TOTALS_LOOKUP_MAX_IDS));
  }
  const pages = await Promise.all(
    batches.map((batch) =>
      fetchParsed(
        `/orders/lines?ids=${encodeURIComponent(batch.join(','))}`,
        orderLinesLookupResponseSchema,
      ),
    ),
  );
  const linesByOrder = new Map<string, readonly OrderLine[]>();
  for (const page of pages) {
    for (const item of page.items) {
      linesByOrder.set(item.orderId, item.lines);
    }
  }
  return linesByOrder;
}
