// Tests that every act waiting on another desk links to that desk's queue.
import { ORDER_STATUSES, QUOTE_STATUSES, type ErpRole } from '@erp/types';
import { describe, expect, it } from 'vitest';

import { orderWork } from '../work/order-work';
import { quoteWork, type QuoteWorkItem } from '../work/quote-work';
import type { Work } from '../work/work';
import { queueFor } from './queues';

const NOW = new Date('2026-10-07T18:00:00.000Z');
const CHANGED = '2026-10-07T15:00:00.000Z';
const NOBODY: readonly ErpRole[] = [];

function quote(overrides: Partial<QuoteWorkItem>): QuoteWorkItem {
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

function everyWork(): readonly Work[] {
  const works: Work[] = [];
  for (const status of ORDER_STATUSES) {
    works.push(
      orderWork({ order: { id: 'o-1', status, updatedAt: CHANGED }, roles: NOBODY, now: NOW }),
    );
  }
  for (const status of QUOTE_STATUSES) {
    for (const overrides of [
      { lineCount: 0 },
      { belowFloorCount: 1 },
      { belowFloorCount: 1, manualCount: 1 },
      { belowFloorCount: 1, floorOverrideAt: CHANGED },
      { manualCount: 1 },
      { manualCount: 2 },
      { manualCount: 1, manualPricePerRoll: '12.0000' },
      { leadTimeDays: undefined },
      {},
    ]) {
      works.push(
        quoteWork({ quote: quote({ status, ...overrides }), orders: [], roles: NOBODY, now: NOW }),
      );
    }
  }
  return works;
}

describe('queueFor', () => {
  it("links a queue for every act that is another desk's", () => {
    const waiting = everyWork().filter((work) => work.group === 'another-desk');
    expect(waiting.length).toBeGreaterThan(0);
    for (const work of waiting) {
      expect(queueFor(work), `${String(work.next)} (${String(work.desk)})`).toBeDefined();
    }
  });

  it('has nothing for the customer or a record with nothing left', () => {
    const customer = everyWork().filter((work) => work.group === 'customer');
    expect(customer.length).toBeGreaterThan(0);
    for (const work of customer) expect(queueFor(work)).toBeUndefined();
    for (const work of everyWork().filter((w) => w.group === 'done' || w.group === 'closed')) {
      expect(queueFor(work)).toBeUndefined();
    }
  });

  it('names the queue each next step belongs to', () => {
    const base: Work = {
      group: 'another-desk',
      next: 'Enter the lead time',
      with: 'Production',
      desk: 'Production',
      ageFrom: CHANGED,
      href: '/quoting/quotes/q-1',
    };
    expect(queueFor(base)).toEqual({
      href: '/production/lead-times',
      label: "Production's quote queue",
    });
    expect(
      queueFor({
        ...base,
        next: 'Approve the hand-set price of $12.00 per roll',
        with: 'The Billing Manager',
        desk: 'The Billing Manager',
      }),
    ).toEqual({ href: '/approvals#price-approvals', label: "The Billing Manager's approvals" });

    expect(
      queueFor({
        ...base,
        next: 'Decide the line below the floor',
        with: 'An Admin',
        desk: 'An Admin',
      }),
    ).toEqual({ href: '/approvals#price-approvals', label: 'Approvals' });
    expect(queueFor({ ...base, next: 'Request approval', with: 'Sales', desk: 'Sales' })).toEqual({
      href: '/quoting/quotes',
      label: "Sales' quotes",
    });
  });
});
