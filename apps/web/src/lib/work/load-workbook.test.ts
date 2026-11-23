// Tests the workbook helpers: orders by quote, refused reads, and the customer ids to load.
import type { Order } from '@erp/types';
import { describe, expect, it } from 'vitest';

import { customerIdsOf, listRead, ordersByQuote, settleReads } from './load-workbook';

function order(id: string, quoteId: string, createdAt: string): Order {
  return { id, quoteId, customerId: `c-${id}`, createdAt } as Order;
}

describe('ordersByQuote', () => {
  it('groups by quote, oldest first, so the newest is last', () => {
    const byQuote = ordersByQuote([
      order('o-new', 'q-1', '2026-10-07T00:00:00.000Z'),
      order('o-other', 'q-2', '2026-10-01T00:00:00.000Z'),
      order('o-old', 'q-1', '2026-10-02T00:00:00.000Z'),
    ]);
    expect(byQuote.get('q-1')?.map((o) => o.id)).toEqual(['o-old', 'o-new']);
    expect(byQuote.get('q-2')?.map((o) => o.id)).toEqual(['o-other']);
  });
});

describe('settleReads', () => {
  it('reads a refused list as empty and names its path, in the order given', () => {
    const orders = { items: [order('o-1', 'q-1', '2026-10-07T00:00:00.000Z')] };
    const { lists, refused } = settleReads({
      quoteList: listRead('/quoting/quotes', null, { items: [] }),
      orderList: listRead('/orders', orders, { items: [] }),
      approvals: listRead('/approvals/pending', null, { items: [] }),
    });
    expect(lists.quoteList).toEqual({ items: [] });
    expect(lists.orderList).toBe(orders);
    expect(lists.approvals).toEqual({ items: [] });
    expect(refused).toEqual(['/quoting/quotes', '/approvals/pending']);
  });

  it('names nothing when every list was read', () => {
    expect(settleReads({ orderList: listRead('/orders', { items: [] }, { items: [] }) })).toEqual({
      lists: { orderList: { items: [] } },
      refused: [],
    });
  });
});

describe('customerIdsOf', () => {
  it('names each customer once, across quotes, orders and approvals', () => {
    expect(
      customerIdsOf(
        [{ customerId: 'c-1' }, { customerId: 'c-2' }],
        [{ customerId: 'c-2' }],
        [
          {
            kind: 'credit-hold',
            approvalId: 'a-1',
            customerId: 'c-3',
            reason: 'r',
            requestedBy: 'u',
            requestedAt: '2026-10-07T11:00:00.000Z',
          },
        ],
      ),
    ).toEqual(['c-1', 'c-2', 'c-3']);
  });
});
