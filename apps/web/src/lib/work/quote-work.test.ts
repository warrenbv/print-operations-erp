// Tests the quote work row for every Next line label and desk, and the approval wording.
import { QUOTE_STATUSES, type ErpRole } from '@erp/types';
import { describe, expect, it } from 'vitest';

import { formatAge } from '../dates';
import {
  approvePriceWords,
  quoteWork,
  type QuoteWorkInput,
  type QuoteWorkItem,
} from './quote-work';
import type { Work } from './work';

const NOW = new Date('2026-10-07T18:00:00.000Z');
const CHANGED = '2026-10-07T15:00:00.000Z';

function quote(overrides: Partial<QuoteWorkItem> = {}): QuoteWorkItem {
  return {
    id: 'q-1',
    status: 'draft',
    leadTimeDays: 10,
    overrideApprovedAt: undefined,
    updatedAt: CHANGED,
    lineCount: 2,
    belowFloorCount: 0,
    manualCount: 0,
    manualPricePerRoll: null,
    ...overrides,
  };
}

function work(
  overrides: Partial<QuoteWorkItem>,
  roles: readonly ErpRole[],
  orders: QuoteWorkInput['orders'] = [],
): Work {
  return quoteWork({ quote: quote(overrides), orders, roles, now: NOW });
}

const ORDER_WORK: Work = {
  group: 'another-desk',
  next: 'Confirm the order',
  with: 'The Production Manager',
  desk: 'The Production Manager',
  ageFrom: '2026-10-07T16:00:00.000Z',
  href: '/orders/o-2',
};

describe('quoteWork, the acceptance cases', () => {
  it('a draft with no lines is the Sales reader\'s: "Add the first line"', () => {
    expect(work({ lineCount: 0 }, ['Sales'])).toEqual({
      group: 'yours',
      next: 'Add the first line',
      with: 'You',

      desk: 'Sales',
      ageFrom: CHANGED,
      href: '/quoting/quotes/q-1#lines',
    });
  });

  it('a priced draft with no lead time waits on Production for a Sales reader', () => {
    expect(work({ leadTimeDays: undefined }, ['Sales'])).toEqual({
      group: 'another-desk',
      next: 'Enter the lead time',
      with: 'Production',
      desk: 'Production',
      ageFrom: CHANGED,
      href: '/quoting/quotes/q-1',
    });
  });

  it('override_requested waits on the Billing Manager for Sales, and is yours for Billing', () => {
    const awaiting = {
      status: 'override_requested' as const,
      manualCount: 1,
      manualPricePerRoll: '12.0000',
    };
    expect(work(awaiting, ['Sales'])).toMatchObject({
      group: 'another-desk',
      next: 'Approve the hand-set price of $12.00 per roll',
      with: 'The Billing Manager',
    });
    expect(work(awaiting, ['Billing'])).toEqual({
      group: 'yours',
      next: 'Approve the hand-set price of $12.00 per roll',
      with: 'You',
      desk: 'The Billing Manager',
      ageFrom: CHANGED,
      href: '/approvals',
    });
  });

  it('quoted without an order is with the customer, for every reader', () => {
    for (const roles of [['Sales'], ['Admin'], []] as const) {
      expect(work({ status: 'quoted' }, roles)).toEqual({
        group: 'customer',
        next: 'Convert to an order when the customer says yes',
        with: 'Customer',
        desk: null,
        ageFrom: CHANGED,
        href: '/quoting/quotes/q-1/convert',
      });
    }
  });

  it("quoted with orders is listed with orders, carrying the newest order's work", () => {
    const older: Work = {
      ...ORDER_WORK,
      next: 'Email the order confirmation',
      href: '/orders/o-1',
    };
    expect(
      work(
        { status: 'quoted' },
        ['Sales'],
        [
          { id: 'o-1', work: older },
          { id: 'o-2', work: ORDER_WORK },
        ],
      ),
    ).toEqual({ ...ORDER_WORK, group: 'converted' });
  });

  it('a record changed today ages "today", from its updatedAt', () => {
    const { ageFrom } = work({}, ['Sales']);
    expect(ageFrom).toBe(CHANGED);
    expect(formatAge(ageFrom, NOW)).toBe('today');
  });
});

describe('quoteWork, every label on the Next line', () => {
  it.each([
    [{ lineCount: 0 }, 'Add the first line', 'Sales', '#lines'],
    [{ belowFloorCount: 1 }, 'Request approval', 'Sales', '/quoting/quotes/q-1/review'],
    [
      { status: 'override_requested', belowFloorCount: 1 },
      'Decide the line below the floor',
      'An Admin',
      '/approvals',
    ],
    [{ manualCount: 1 }, 'Request price approval', 'Sales', '/quoting/quotes/q-1/review'],
    [
      { status: 'override_requested', manualCount: 2 },
      'Approve 2 hand-set prices',
      'The Billing Manager',
      '/approvals',
    ],
    [{ leadTimeDays: undefined }, 'Enter the lead time', 'Production', '#lead-time'],
    [{}, 'Send the quote', 'Sales', '/quoting/quotes/q-1/review'],
  ] as const)('%o: "%s", with %s', (overrides, next, desk, anchor) => {
    expect(work(overrides, [])).toMatchObject({ group: 'another-desk', next, with: desk, desk });

    expect(work(overrides, ['Admin'])).toMatchObject({
      group: 'yours',
      next,
      with: 'You',
      desk,
      href: anchor.startsWith('#') ? `/quoting/quotes/q-1${anchor}` : anchor,
    });
  });

  it('a quote owing both is asked for once, and decided floor first', () => {
    expect(work({ belowFloorCount: 1, manualCount: 1 }, ['Sales']).next).toBe('Request approval');
    expect(
      work({ status: 'override_requested', belowFloorCount: 1, manualCount: 1 }, ['Billing']),
    ).toMatchObject({
      group: 'another-desk',
      next: 'Decide the line below the floor',
      with: 'An Admin',
    });
  });

  it('a live floor override reads as no floor, so the price is what is left', () => {
    const overridden = { belowFloorCount: 1, floorOverrideAt: '2026-10-06T10:00:00.000Z' };
    expect(work(overridden, ['Sales']).next).toBe('Send the quote');
    expect(
      work({ ...overridden, status: 'override_requested', manualCount: 1 }, ['Billing']),
    ).toMatchObject({
      group: 'yours',
      next: 'Approve the hand-set price',
      desk: 'The Billing Manager',
    });
  });

  it('a requested floor quote is never the Billing Manager’s, nor Sales’', () => {
    for (const roles of [['Billing'], ['Sales']] as const) {
      expect(work({ status: 'override_requested', belowFloorCount: 1 }, roles)).toMatchObject({
        group: 'another-desk',
        with: 'An Admin',
        href: '/quoting/quotes/q-1',
      });
    }
  });

  it('a live approval lets the send through', () => {
    expect(
      work({ manualCount: 1, overrideApprovedAt: '2026-10-06T10:00:00.000Z' }, ['Sales']).next,
    ).toBe('Send the quote');
  });

  it.each(['superseded', 'closed_lost'] as const)('%s is closed', (status) => {
    expect(work({ status }, ['Sales'])).toEqual({
      group: 'closed',
      next: null,
      with: null,
      desk: null,
      ageFrom: CHANGED,
      href: '/quoting/quotes/q-1',
    });
  });

  it('gives every quote status a group', () => {
    for (const status of QUOTE_STATUSES) {
      expect(work({ status }, ['Sales']).group).toBeTypeOf('string');
    }
  });

  it('a quote whose orders are all cancelled is still listed with orders, closed with its order', () => {
    const cancelled: Work = {
      group: 'closed',
      next: null,
      with: null,
      desk: null,
      ageFrom: '2026-10-05T10:00:00.000Z',
      href: '/orders/o-1',
    };
    expect(work({ status: 'quoted' }, ['Sales'], [{ id: 'o-1', work: cancelled }])).toEqual({
      ...cancelled,
      group: 'converted',
    });
  });
});

describe('quoteWork, whose desk', () => {
  it("Admin beside Sales works the Sales desk: the lead time is Production's", () => {
    expect(work({ leadTimeDays: undefined }, ['Admin', 'Sales'])).toMatchObject({
      group: 'another-desk',
      with: 'Production',
    });
  });

  it("a Production reader on an empty draft: Sales' act", () => {
    expect(work({ lineCount: 0 }, ['Production'])).toMatchObject({
      group: 'another-desk',
      next: 'Add the first line',
      with: 'Sales',
      href: '/quoting/quotes/q-1',
    });
  });

  it('a Production reader enters the lead time', () => {
    expect(work({ leadTimeDays: undefined }, ['Production'])).toMatchObject({
      group: 'yours',
      href: '/quoting/quotes/q-1#lead-time',
    });
  });
});

describe('approvePriceWords', () => {
  it('names one price at the cent, half-up', () => {
    expect(approvePriceWords(1, '27.3450')).toBe('Approve the hand-set price of $27.35 per roll');
  });

  it('counts several', () => {
    expect(approvePriceWords(3, '12.0000')).toBe('Approve 3 hand-set prices');
  });

  it('says the bare act when the price is not known', () => {
    expect(approvePriceWords(1, null)).toBe('Approve the hand-set price');
  });
});
