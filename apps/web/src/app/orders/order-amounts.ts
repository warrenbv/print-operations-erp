// Reads the totals of a list of orders, in batches no larger than the API accepts (`ORDER_TOTALS_LOOKUP_MAX_IDS`).
import { ORDER_TOTALS_LOOKUP_MAX_IDS, orderTotalsLookupResponseSchema } from '@erp/types';

import { apiFetch } from '../../lib/api-fetch';
import { pathForLog } from '../../lib/path-for-log';

export interface OrderAmount {
  amount: string;

  freightPending: boolean;
}

export async function loadOrderAmounts(
  orderIds: readonly string[],
): Promise<ReadonlyMap<string, OrderAmount>> {
  const unique = [...new Set(orderIds)];
  const amounts = new Map<string, OrderAmount>();
  if (unique.length === 0) return amounts;

  const batches: string[][] = [];
  for (let i = 0; i < unique.length; i += ORDER_TOTALS_LOOKUP_MAX_IDS) {
    batches.push(unique.slice(i, i + ORDER_TOTALS_LOOKUP_MAX_IDS));
  }

  const pages = await Promise.all(
    batches.map(async (batch) => {
      const path = `/orders/totals?ids=${encodeURIComponent(batch.join(','))}`;
      const response = await apiFetch(path);

      if (!response.ok) throw new Error(`${pathForLog(path)} responded ${response.status}`);
      return orderTotalsLookupResponseSchema.parse(await response.json());
    }),
  );

  for (const page of pages) {
    for (const item of page.items) {
      amounts.set(item.orderId, {
        amount: item.totals.extendedPrice,
        freightPending: item.totals.freightPending,
      });
    }
  }
  return amounts;
}
