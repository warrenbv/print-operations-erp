// Tests the four quote steps: their states, links and summaries, on New quote and on an existing draft.
import { describe, expect, it } from 'vitest';

import type { QuoteLine } from '@erp/types';

import {
  deliverySettled,
  deliverySummary,
  linesSettled,
  linesSummary,
  newQuoteSteps,
  quoteSteps,
  reviewSummary,
} from './steps';

type Line = Pick<QuoteLine, 'freight' | 'taxStatus' | 'deliveryAddress'>;

const warehouseIdaho: Line = { freight: { mode: 'our_vehicle' }, taxStatus: 'id_tax' } as Line;
const plantIdaho: Line = { freight: { mode: 'pickup' }, taxStatus: 'id_tax' } as Line;
const carrierWashington: Line = {
  freight: { mode: 'carrier' },
  taxStatus: 'wa_tax',
} as Line;

describe('the four Quote steps', () => {
  const steps = quoteSteps({
    quoteId: 'q1',
    customerName: 'Northstar Demo Packaging & Supply',
    lines: [warehouseIdaho],
    openRows: 1,
    leadTimeDays: undefined,
  });

  it('reads 1 done, 2 current, 3 and 4 ahead', () => {
    expect(steps.map((s) => [s.number, s.label, s.state])).toEqual([
      [1, 'Customer', 'done'],
      [2, 'Lines', 'current'],
      [3, 'Delivery and tax', 'todo'],
      [4, 'Review and send', 'todo'],
    ]);
    expect(steps.map((s) => s.summary)).toEqual([
      'Northstar Demo Packaging & Supply',
      '1 priced, 1 being added',
      'Collected at the warehouse, Idaho taxable',
      'Waits for the lead time',
    ]);
  });

  it('links every step but the current one, to a page that exists tonight', () => {
    expect(steps[0]?.href).toBe('/quoting/quotes/q1/customer');
    expect(steps[1]?.href).toBeUndefined();
    expect(steps[2]?.href).toBe('/quoting/quotes/q1/delivery');
    expect(steps[3]?.href).toBe('/quoting/quotes/q1/review');
  });

  it('ticks the customer step and nothing else', () => {
    expect(steps.map((s) => s.done)).toEqual([true, false, false, false]);
  });
});

describe('the Review and send step', () => {
  const steps = quoteSteps({
    quoteId: 'q1',
    customerName: 'Northstar Demo Packaging & Supply',
    lines: [warehouseIdaho],
    openRows: 0,
    leadTimeDays: 10,
    current: 4,
  });

  it('is current on its own page, and the three before it are links', () => {
    expect(steps.map((s) => [s.number, s.state])).toEqual([
      [1, 'done'],
      [2, 'done'],
      [3, 'done'],
      [4, 'current'],
    ]);
    expect(steps[3]?.href).toBeUndefined();
    expect(steps[1]?.href).toBe('/quoting/quotes/q1');
    expect(steps[3]?.summary).toBe('Everything is in');
  });

  it('ticks steps 2 and 3 once their facts are settled, and only then', () => {
    expect(steps.map((s) => s.done)).toEqual([true, true, true, false]);

    const delivered = quoteSteps({
      quoteId: 'q1',
      customerName: 'Northstar Demo Packaging & Supply',
      lines: [carrierWashington],
      openRows: 0,
      leadTimeDays: 10,
      current: 4,
    });
    expect(delivered.map((s) => s.done)).toEqual([true, true, true, false]);

    const empty = quoteSteps({
      quoteId: 'q1',
      customerName: 'Northstar Demo Packaging & Supply',
      lines: [],
      openRows: 0,
      leadTimeDays: 10,
      current: 4,
    });
    expect(empty.map((s) => [s.state, s.done])).toEqual([
      ['done', true],
      ['todo', false],
      ['todo', false],
      ['current', false],
    ]);
  });
});

describe('the customer step of an existing draft', () => {
  const steps = quoteSteps({
    quoteId: 'q1',
    customerName: 'Northstar Demo Packaging & Supply',
    lines: [],
    openRows: 0,
    leadTimeDays: undefined,
    current: 1,
  });

  it('is current and done at once, and the Lines step becomes a link', () => {
    expect(steps.map((s) => [s.number, s.state, s.done])).toEqual([
      [1, 'current', true],
      [2, 'todo', false],
      [3, 'todo', false],
      [4, 'todo', false],
    ]);
    expect(steps[0]?.href).toBeUndefined();
    expect(steps[1]?.href).toBe('/quoting/quotes/q1');
  });
});

describe('the Delivery and tax step', () => {
  const steps = quoteSteps({
    quoteId: 'q1',
    customerName: 'Northstar Demo Packaging & Supply',
    lines: [warehouseIdaho],
    openRows: 0,
    leadTimeDays: undefined,
    current: 3,
  });

  it('is current, the customer step is done, and the Lines step is a link', () => {
    expect(steps.map((s) => [s.number, s.state])).toEqual([
      [1, 'done'],
      [2, 'done'],
      [3, 'current'],
      [4, 'todo'],
    ]);
    expect(steps[2]?.href).toBeUndefined();
    expect(steps[1]?.href).toBe('/quoting/quotes/q1');
  });
});

describe('the steps on New quote', () => {
  const steps = newQuoteSteps();

  it('has step 1 current and nothing done, linked or current after it', () => {
    expect(steps.map((s) => [s.number, s.label, s.state, s.done])).toEqual([
      [1, 'Customer', 'current', false],
      [2, 'Lines', 'todo', false],
      [3, 'Delivery and tax', 'todo', false],
      [4, 'Review and send', 'todo', false],
    ]);
    expect(steps.every((s) => s.href === undefined)).toBe(true);
    expect(steps.map((s) => s.summary)).toEqual([
      'Pick the account below',
      'No lines yet',
      'Nothing to deliver yet',
      'Nothing to send yet',
    ]);
  });
});

describe('when a step is settled', () => {
  it('settles the Lines step when every line is priced and none is being added', () => {
    expect(linesSettled(2, 0)).toBe(true);
    expect(linesSettled(2, 1)).toBe(false);
    expect(linesSettled(0, 0)).toBe(false);
  });

  it('settles Delivery and tax once a line exists', () => {
    expect(deliverySettled(1)).toBe(true);
    expect(deliverySettled(2)).toBe(true);
    expect(deliverySettled(0)).toBe(false);
  });
});

describe('the Lines summary', () => {
  it('counts the priced lines and the row being added', () => {
    expect(linesSummary(1, 1)).toBe('1 priced, 1 being added');
    expect(linesSummary(3, 0)).toBe('3 lines, all priced');
    expect(linesSummary(1, 0)).toBe('1 line, all priced');
    expect(linesSummary(0, 1)).toBe('1 being added');
    expect(linesSummary(0, 0)).toBe('No lines yet');
  });
});

describe('the Delivery and tax summary', () => {
  it('says the shipping and the tax once when every line agrees', () => {
    expect(deliverySummary([warehouseIdaho, warehouseIdaho])).toBe(
      'Collected at the warehouse, Idaho taxable',
    );
    expect(deliverySummary([carrierWashington])).toBe('Delivered, Washington taxable');
  });

  it('says mixed when the lines differ', () => {
    expect(deliverySummary([warehouseIdaho, plantIdaho])).toBe('Mixed shipping, Idaho taxable');
    expect(deliverySummary([warehouseIdaho, carrierWashington])).toBe('Mixed shipping, mixed tax');
  });

  it('has nothing to say before there is a line', () => {
    expect(deliverySummary([])).toBe('Nothing to deliver yet');
  });
});

describe('the Review and send summary', () => {
  it('names what it waits for, first thing first', () => {
    expect(reviewSummary(0, 1, undefined)).toBe('1 line to price');
    expect(reviewSummary(0, 0, 10)).toBe('1 line to price');
    expect(reviewSummary(2, 1, undefined)).toBe('Waits for the lead time');

    expect(reviewSummary(2, 1, 0)).toBe('Everything is in');
  });
});
