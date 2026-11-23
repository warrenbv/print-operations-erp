// Tests the Quotes list grouping, its show filter, the closed fold and the no-rep footnote.
import { describe, expect, it } from 'vitest';

import type { Work, WorkGroup } from '../../../lib/work/work';
import {
  closedSum,
  noRepFootnote,
  parseShow,
  queueChipLabel,
  quoteQueue,
  SHOW_OPTIONS,
  successorOf,
  whatHappened,
  type QueueOrder,
  type QueueQuote,
} from './queue';

let serial = 0;

function row(
  group: WorkGroup,
  ageFrom: string,
  extra: {
    status?: QueueQuote['quote']['status'];
    order?: QueueOrder;
    orderCount?: number;
    salesRep?: string;
  } = {},
): QueueQuote {
  serial += 1;
  const work: Work = {
    group,
    next: group === 'closed' ? null : 'Do it',
    with: group === 'closed' ? null : 'You',
    desk: group === 'closed' ? null : 'Sales',
    ageFrom,
    href: `/quoting/quotes/q${String(serial)}`,
  };
  return {
    quote: {
      id: `q${String(serial)}`,
      quoteNumber: serial,
      versionNumber: 1,
      rootQuoteId: `q${String(serial)}`,
      customerId: 'c1',
      status: extra.status ?? 'draft',
      salesRep: extra.salesRep,
      updatedAt: ageFrom,
    },
    work,
    order: extra.order,
    orderCount: extra.orderCount,
  };
}

const order = (
  status: QueueOrder['status'],
  createdAt = '2026-09-20T00:00:00.000Z',
): QueueOrder => ({
  id: `o${status}${createdAt}`,
  status,
  createdAt,
});

describe('parseShow', () => {
  it('reads each option and defaults anything else to Open quotes', () => {
    expect(SHOW_OPTIONS.find((option) => option.value === 'converted')?.label).toBe(
      'Quoted, with orders',
    );
    expect(parseShow('converted')).toBe('converted');
    expect(parseShow('closed')).toBe('closed');
    expect(parseShow('everything')).toBe('everything');
    expect(parseShow(undefined)).toBe('open');
    expect(parseShow('nonsense')).toBe('open');
  });
});

describe('quoteQueue', () => {
  const yoursNew = row('yours', '2026-10-06T00:00:00.000Z');
  const yoursOld = row('yours', '2026-10-01T00:00:00.000Z');
  const desk = row('another-desk', '2026-10-03T00:00:00.000Z');
  const customer = row('customer', '2026-09-25T00:00:00.000Z', { status: 'quoted' });
  const converted = row('converted', '2026-09-20T00:00:00.000Z', {
    status: 'quoted',
    order: order('confirmed'),
  });
  const lost = row('closed', '2026-09-30T00:00:00.000Z', { status: 'closed_lost' });
  const all = [yoursNew, desk, converted, lost, customer, yoursOld];

  it('draws the four groups in order, oldest first, with whole-group counts', () => {
    const queue = quoteQueue(all, 'open');
    expect(queue.groups.map((group) => group.heading)).toEqual([
      'Your move (2)',
      'Waiting on another desk (1)',
      'Quoted, with the customer (1)',
      'Quoted, with orders (1)',
    ]);
    expect(queue.groups[0]?.rows).toEqual([yoursOld, yoursNew]);
    expect(queue.closed).toEqual([lost]);
    expect(queue.foldOpen).toBe(false);
  });

  it('leaves an empty group out', () => {
    const queue = quoteQueue([yoursOld], 'open');
    expect(queue.groups.map((group) => group.id)).toEqual(['yours']);
  });

  it('narrows to the quotes with orders, with no fold', () => {
    const queue = quoteQueue(all, 'converted');
    expect(queue.groups.map((group) => group.id)).toEqual(['converted']);
    expect(queue.closed).toBeNull();
  });

  it('shows only the fold, open, for closed and superseded', () => {
    const queue = quoteQueue(all, 'closed');
    expect(queue.groups).toEqual([]);
    expect(queue.closed).toEqual([lost]);
    expect(queue.foldOpen).toBe(true);
  });

  describe('the quotes with orders', () => {
    const withOrders = Array.from({ length: 8 }, (_, i) =>
      row('converted', `2026-08-0${String(i + 1)}T00:00:00.000Z`, {
        status: 'quoted',
        order: order(
          i % 2 === 0 ? 'converted' : 'confirmed',
          `2026-09-1${String(i)}T00:00:00.000Z`,
        ),
        orderCount: i + 1,
      }),
    );

    it('shows every row under Open quotes, newest order first', () => {
      for (const show of ['open', 'everything', 'converted'] as const) {
        const group = quoteQueue(withOrders, show).groups[0];
        expect(group?.heading).toBe('Quoted, with orders (8)');
        expect(group?.rows).toEqual([...withOrders].reverse());
      }
    });

    it('chips a quote with orders by its count, every other row by its status', () => {
      expect(queueChipLabel('quoted', 'converted', 1)).toBe('Quoted, 1 order so far');
      expect(queueChipLabel('quoted', 'converted', 2)).toBe('Quoted, 2 orders so far');
      expect(queueChipLabel('quoted', 'customer', undefined)).toBe('Quoted');
      expect(queueChipLabel('draft', 'yours', undefined)).toBe('Draft');
    });
  });
});

describe('the closed fold', () => {
  const v1 = { rootQuoteId: 'r', versionNumber: 1, quoteNumber: 47, status: 'superseded' as const };
  const v2 = { rootQuoteId: 'r', versionNumber: 2, quoteNumber: 47, status: 'quoted' as const };
  const other = { rootQuoteId: 's', versionNumber: 2, quoteNumber: 4, status: 'draft' as const };

  it('finds the next version in the same chain', () => {
    expect(successorOf(v1, [other, v1, v2])).toBe(v2);
    expect(successorOf(v2, [other, v1, v2])).toBeUndefined();
  });

  it('says what happened', () => {
    expect(whatHappened(v1, v2)).toBe('Revised into Q-00047 v2');
    expect(whatHappened(v1, undefined)).toBe('Revised into a newer version');
    expect(whatHappened({ status: 'closed_lost' }, undefined)).toBe('Closed as lost');
  });

  it('sums the fold in a few words', () => {
    const superseded = row('closed', '2026-10-06T00:00:00.000Z', { status: 'superseded' });
    const lost = row('closed', '2026-09-30T00:00:00.000Z', { status: 'closed_lost' });
    const sum = closedSum([superseded, lost], (r) =>
      r === superseded ? { versionNumber: 2 } : undefined,
    );
    expect(sum).toBe(
      `${'Q-' + String(superseded.quote.quoteNumber).padStart(5, '0')} superseded by v2 · ` +
        `${'Q-' + String(lost.quote.quoteNumber).padStart(5, '0')} closed as lost`,
    );
  });
});

describe('noRepFootnote', () => {
  const names: Record<string, string> = { a: 'Cedar Demo Outfitters', b: 'Sample Paper Co' };
  const name = (id: string) => names[id] ?? id;

  it('names each customer with its count, most first', () => {
    expect(
      noRepFootnote(
        [
          { customerId: 'b', salesRep: undefined },
          { customerId: 'a', salesRep: undefined },
          { customerId: 'a', salesRep: undefined },
          { customerId: 'a', salesRep: 'demo-sales-d' },
        ],
        name,
      ),
    ).toBe(
      '3 quotes have no rep and show under All reps: Cedar Demo Outfitters (2) and Sample Paper Co (1).',
    );
  });

  it('is singular for one, and absent when every quote has a rep', () => {
    expect(noRepFootnote([{ customerId: 'b', salesRep: undefined }], name)).toBe(
      '1 quote has no rep and shows under All reps: Sample Paper Co (1).',
    );
    expect(noRepFootnote([{ customerId: 'a', salesRep: 'demo-sales-d' }], name)).toBeNull();
  });
});
