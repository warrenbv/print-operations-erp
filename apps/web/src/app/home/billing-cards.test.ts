// Tests the Billing Manager's cards on Your work.
import type { Customer, PendingApproval } from '@erp/types';
import { describe, expect, it } from 'vitest';

import type { Workbook } from '../../lib/work/load-workbook';
import type { Work } from '../../lib/work/work';
import { billingCards } from './billing-cards';

const NOW = new Date('2026-10-07T21:10:00.000Z');
const TODAY = '2026-10-07T16:00:00.000Z';
const DAYS_AGO_2 = '2026-10-05T16:00:00.000Z';
const DAYS_AGO_19 = '2026-09-18T16:00:00.000Z';

function work(overrides: Partial<Work>): Work {
  return {
    group: 'yours',
    next: null,
    with: 'You',
    desk: null,
    ageFrom: TODAY,
    href: '/somewhere',
    ...overrides,
  };
}

function workbook(fields: Partial<Workbook>): Workbook {
  return {
    quotes: [],
    orders: [],
    approvals: [],
    customers: new Map([
      ['c-1', { id: 'c-1', name: 'Juniper Demo Foods' } as Customer],
      ['c-2', { id: 'c-2', name: 'Northstar Demo Supplies' } as Customer],
    ]),
    ...fields,
  } as unknown as Workbook;
}

describe('billingCards', () => {
  const approvals: PendingApproval[] = [
    {
      kind: 'price-override',
      quoteId: 'q-5',
      customerId: 'c-1',
      quoteNumber: 63,
      versionNumber: 1,
      salesRep: 'jordan',
      requestedAt: DAYS_AGO_19,
      needs: ['price'],
    },
    {
      kind: 'credit-hold',
      approvalId: '01988a00-0000-7000-8000-000000000001',
      customerId: '01988a00-0000-7000-8000-0000000000c2',
      reason: 'Paid up by phone',
      requestedBy: 'dev-sales',
      requestedAt: DAYS_AGO_2,
    },
  ];
  const wb = workbook({
    approvals,
    quotes: [
      {
        quote: {
          id: 'q-5',
          quoteNumber: 63,
          versionNumber: 1,
          manualCount: 1,
          manualPricePerRoll: '12.0000',
        },
        work: work({}),
      },
    ] as unknown as Workbook['quotes'],
    customers: new Map([
      [
        '01988a00-0000-7000-8000-0000000000c2',
        { id: '01988a00-0000-7000-8000-0000000000c2', name: 'Sample Paper Co' } as Customer,
      ],
    ]),
  });
  const built = billingCards(wb, NOW, new Map([['jordan', 'Jordan Demo']]));

  it('names the price, the asking rep by name, and the wait', () => {
    expect(built.cards['price-approvals']?.rows).toEqual([
      {
        href: '/approvals#price-approvals',
        text: 'Q-00063 · $12.00 per roll, asked by Jordan Demo',
        age: '19 days',
        late: true,
      },
    ]);
  });

  it('names the customer on an exception', () => {
    expect(built.cards.exceptions?.rows[0]).toMatchObject({
      href: '/approvals#exceptions',
      text: 'Sample Paper Co',
      age: '2 days',
    });
  });

  it('reads a rep the map does not know as stored, and several prices by their number', () => {
    const several = workbook({
      approvals: [approvals[0] as PendingApproval],
      quotes: [
        {
          quote: { id: 'q-5', quoteNumber: 63, versionNumber: 1, manualCount: 2 },
          work: work({}),
        },
      ] as unknown as Workbook['quotes'],
    });
    expect(billingCards(several, NOW, new Map()).cards['price-approvals']?.rows[0]?.text).toBe(
      'Q-00063 · 2 hand-set prices, asked by jordan',
    );
  });

  it('counts every decision as the reader’s to act on', () => {
    expect(built.actNow).toEqual({
      quotes: ['q-5'],
      orders: [],
      exceptions: ['01988a00-0000-7000-8000-000000000001'],
    });
  });

  it('leaves out a quote that owes only the floor, an Admin’s decision', () => {
    const floorOnly = { ...approvals[0], needs: ['floor'] } as PendingApproval;
    const both = { ...approvals[0], needs: ['price', 'floor'] } as PendingApproval;
    expect(
      billingCards(workbook({ approvals: [floorOnly] }), NOW, new Map()).cards['price-approvals']
        ?.rows,
    ).toEqual([]);
    expect(
      billingCards(workbook({ approvals: [floorOnly] }), NOW, new Map()).actNow.quotes,
    ).toEqual([]);
    expect(billingCards(workbook({ approvals: [both] }), NOW, new Map()).actNow.quotes).toEqual([
      'q-5',
    ]);
  });
});
