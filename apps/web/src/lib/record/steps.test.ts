// Tests the step each status sits on and when a step links to its record.
import { ORDER_STATUSES, QUOTE_STATUSES, type OrderStatus, type QuoteStatus } from '@erp/types';
import { describe, expect, it } from 'vitest';

import { STEPS, stepHref, stepIndex, stepOf, type StepLabel, type StepRecords } from './steps';

const QUOTE: Record<QuoteStatus, StepLabel | null> = {
  draft: 'Quote',
  override_requested: 'Quote',
  quoted: 'Quote',
  superseded: null,
  closed_lost: null,
};

const ORDER: Record<OrderStatus, StepLabel> = {
  converted: 'Order',
  confirmed: 'Confirmed',
};

describe('STEPS', () => {
  it('is the three steps in order', () => {
    expect(STEPS).toEqual(['Quote', 'Order', 'Confirmed']);
    expect(STEPS.map(stepIndex)).toEqual([0, 1, 2]);
  });
});

const ALL: StepRecords = { quoteId: 'q 1', orderId: 'o-1' };
const NONE: StepRecords = { quoteId: null, orderId: null };

describe('stepHref', () => {
  it("opens this item's record for a step it has reached", () => {
    expect(STEPS.map((label) => stepHref(label, true, ALL))).toEqual([
      '/quoting/quotes/q%201',
      '/orders/o-1',
      '/orders/o-1',
    ]);
  });

  it('has no link for a step not reached', () => {
    expect(STEPS.map((label) => stepHref(label, false, ALL))).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
  });

  it('has no link for a reached step whose record the page does not hold', () => {
    expect(STEPS.map((label) => stepHref(label, true, NONE))).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
  });
});

describe('stepOf', () => {
  it.each(QUOTE_STATUSES)('places the quote status %s', (status) => {
    expect(stepOf('quote', status)).toBe(QUOTE[status]);
  });

  it.each(ORDER_STATUSES)('places the order status %s', (status) => {
    expect(stepOf('order', status)).toBe(ORDER[status]);
  });
});
