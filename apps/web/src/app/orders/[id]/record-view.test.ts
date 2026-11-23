// Tests the words on the order page.
import { describe, expect, it } from 'vitest';

import {
  addCalendarDays,
  businessDayOf,
  type Grade,
  type OrderLine,
  type OrderTransition,
  type QuoteSendAttempt,
  type StoredDocumentSummary,
} from '@erp/types';

import {
  chipTone,
  confirmDefault,
  documentsSum,
  historySum,
  lineNote,
  ocLine,
  orderHeading,
  orderLede,
  otherOrders,
  otherOrderWords,
  totalsSum,
  waitingWords,
} from './record-view';

const NOW = new Date('2026-10-08T19:00:00Z');
const TODAY = businessDayOf(NOW);

const KRAFT = { id: 'g-kraft', productFamily: 'kraft', code: '30#' } as Grade;
const BUTCHER = { id: 'g-butcher', productFamily: 'butcher', code: '40#' } as Grade;
const GRADES = new Map([
  [KRAFT.id, KRAFT],
  [BUTCHER.id, BUTCHER],
]);

function line(overrides: Partial<OrderLine> = {}): OrderLine {
  return {
    id: 'l-1',
    lineNumber: 1,
    gradeId: KRAFT.id,
    rollWidthIn: 18,
    feetPerRoll: '1460',
    quantityRolls: 30,
    pallets: 1,
    estimatedWeightLb: '742.61',
    printed: false,
    freight: { mode: 'carrier' },
    deliveryAddress: { city: 'Example City', state: 'ID' },
    ...overrides,
  } as OrderLine;
}

describe('orderHeading', () => {
  it('names an unconfirmed order by its quote, for the customer', () => {
    expect(
      orderHeading({ order: { id: 'o-1' }, quoteRef: 'Q-00072', customerName: 'Northstar Demo' }),
    ).toEqual({ crumbLabel: 'Order from Q-00072', title: 'Order from Q-00072 for Northstar Demo' });
  });

  it('names a confirmed order by its job number alone', () => {
    expect(
      orderHeading({
        order: { id: 'o-1', jobNumber: 'DPW-00309' },
        quoteRef: 'Q-00072',
        customerName: 'Northstar Demo',
      }),
    ).toEqual({ crumbLabel: 'DPW-00309', title: 'DPW-00309 for Northstar Demo' });
  });
});

describe('chipTone', () => {
  it('follows the act: now for the reader, pending for someone else, done when finished', () => {
    expect(chipTone({ tone: 'act' })).toBe('now');
    expect(chipTone({ tone: 'waiting' })).toBe('pending');
    expect(chipTone({ tone: 'done' })).toBe('done');
  });
});

describe('orderLede', () => {
  const converted = { status: 'converted' as const };

  it('reads one line as the line, then the job number tail for whoever confirms', () => {
    expect(
      orderLede({
        order: converted,
        lines: [line()],
        gradeById: GRADES,
        mayConfirm: true,
        now: NOW,
      }),
    ).toBe(
      'Kraft — 30#, 18" × 1,460 ft, 30 rolls, Freight · Example City, ID. The job number is given when you confirm.',
    );
  });

  it('tells anyone else the job number comes on confirmation', () => {
    expect(
      orderLede({
        order: converted,
        lines: [line()],
        gradeById: GRADES,
        mayConfirm: false,
        now: NOW,
      }),
    ).toMatch(/The job number is given on confirmation\.$/);
  });

  it('leaves the footage out of a line converted before it was copied', () => {
    expect(
      orderLede({
        order: converted,
        lines: [line({ feetPerRoll: undefined, quantityRolls: 1, deliveryAddress: undefined })],
        gradeById: GRADES,
        mayConfirm: true,
        now: NOW,
      }),
    ).toMatch(/^Kraft — 30#, 18", 1 roll, Freight\. /);
  });

  it('counts several lines and their rolls', () => {
    expect(
      orderLede({
        order: converted,
        lines: [line(), line({ id: 'l-2', gradeId: BUTCHER.id, quantityRolls: 12 })],
        gradeById: GRADES,
        mayConfirm: true,
        now: NOW,
      }),
    ).toBe('2 lines, 42 rolls. The job number is given when you confirm.');
  });

  const confirmedOn = (leadTime: number) => ({
    status: 'confirmed' as const,
    confirmedAt: NOW.toISOString(),
    confirmedLeadTimeDays: leadTime,
  });
  const lede = (order: ReturnType<typeof confirmedOn>, now = NOW) =>
    orderLede({ order, lines: [line()], gradeById: GRADES, mayConfirm: true, now });

  it('ends a committed job on its due day, in days', () => {
    expect(lede(confirmedOn(12))).toMatch(
      new RegExp(`Due ${addCalendarDays(TODAY, 12)}, in 12 days\\.$`),
    );
  });

  it('says tomorrow, today, and days ago', () => {
    expect(lede(confirmedOn(1))).toMatch(
      new RegExp(`Due ${addCalendarDays(TODAY, 1)}, tomorrow\\.$`),
    );
    expect(lede(confirmedOn(0))).toMatch(new RegExp(`Due today, ${TODAY}\\.$`));
    const later = new Date(NOW.getTime() + 3 * 86_400_000);
    expect(lede(confirmedOn(1), later)).toMatch(
      new RegExp(`Due ${addCalendarDays(TODAY, 1)}, 2 days ago\\.$`),
    );
    expect(lede(confirmedOn(0), new Date(NOW.getTime() + 86_400_000))).toMatch(
      new RegExp(`Due ${TODAY}, 1 day ago\\.$`),
    );
  });
});

describe('confirmDefault', () => {
  it("pre-fills the quote's lead time and says where it came from, with the day it gives", () => {
    expect(confirmDefault(12, NOW)).toEqual({
      value: 12,
      hint: `Pre-filled from the quote. Calendar days from today, weekends included. Due ${addCalendarDays(TODAY, 12)}.`,
    });
  });

  it('keeps the plain hint when the quote has no lead time', () => {
    expect(confirmDefault(undefined, NOW)).toEqual({
      hint: 'Calendar days from today, weekends included. 0 means same day.',
    });
  });
});

describe('waitingWords', () => {
  it('names the Production Manager while the order waits to be confirmed', () => {
    expect(waitingWords('converted')).toBe(
      'The order is confirmed by the Production Manager. You will see it move here.',
    );
  });

  it('has no sentence once confirmed', () => {
    expect(waitingWords('confirmed')).toBeUndefined();
  });
});

describe('lineNote', () => {
  it('gives whether it is printed and the load', () => {
    expect(lineNote(line())).toBe('Plain, not printed. 1 pallet, about 743 lb.');
    expect(lineNote(line({ printed: true, pallets: 2, estimatedWeightLb: '1484.5' }))).toBe(
      'Printed. 2 pallets, about 1,485 lb.',
    );
  });

  it('says pallets not counted for a line with no pallet count', () => {
    expect(lineNote(line({ pallets: null }))).toBe(
      'Plain, not printed. Pallets not counted, about 743 lb.',
    );
  });
});

describe('totalsSum', () => {
  const totals = {
    extendedPrice: '486.19',
    extendedMargin: '158.40',
    freightInvoiceTotal: '0',
    freightPending: false,
  };

  it('says no freight when there is none', () => {
    expect(totalsSum(totals)).toBe('$486.19 · margin $158.40 · no freight');
  });

  it('names the freight, or says it is not final', () => {
    expect(totalsSum({ ...totals, freightInvoiceTotal: '67.00' })).toBe(
      '$486.19 · margin $158.40 · freight $67.00',
    );
    expect(totalsSum({ ...totals, freightInvoiceTotal: '67.00', freightPending: true })).toBe(
      '$486.19 · margin $158.40 · freight not final',
    );
  });
});

describe('otherOrders and otherOrderWords', () => {
  const sibling = (id: string, createdAt: string, requestedDate?: string) => ({
    id,
    createdAt: `${createdAt}T18:00:00Z`,
    ...(requestedDate === undefined ? {} : { requestedDate }),
  });

  it("lists the quote's other orders by delivery date, then the undated newest first", () => {
    const orders = [
      sibling('self', '2026-11-01', '2027-06-10'),
      sibling('undated', '2026-11-04'),
      sibling('july', '2026-11-02', '2027-07-15'),
      sibling('june', '2026-11-03', '2027-06-01'),
    ];
    expect(otherOrders(orders, 'self').map((order) => order.id)).toEqual([
      'june',
      'july',
      'undated',
    ]);
    expect(otherOrders([sibling('self', '2026-11-01')], 'self')).toEqual([]);
  });

  it('says its PO number, its delivery date and its status, or that there is none', () => {
    expect(
      otherOrderWords({ poNumber: '7716402', requestedDate: '2027-07-15', status: 'confirmed' }),
    ).toBe('PO 7716402, delivery 2027-07-15, Confirmed');
    expect(otherOrderWords({ status: 'converted' })).toBe(
      'no PO number, no delivery date, Converted',
    );
  });
});

describe('documentsSum', () => {
  const doc = (overrides: Partial<StoredDocumentSummary>) =>
    ({
      id: 'd',
      kind: 'order_confirmation',
      filename: 'oc.pdf',
      documentAt: '2026-09-18T18:00:00Z',
      ...overrides,
    }) as StoredDocumentSummary;

  it('says nothing is filed', () => {
    expect(documentsSum([])).toBe('nothing filed yet');
  });

  it('names the newest, and who recorded an upload', () => {
    expect(
      documentsSum([
        doc({ id: 'a', documentAt: '2026-09-10T18:00:00Z' }),
        doc({ id: 'b', kind: 'purchase_order', uploadedBy: 'Jordan Demo' }),
      ]),
    ).toBe('customer PO, recorded by Jordan Demo 2026-09-18');
    expect(documentsSum([doc({})])).toBe('order confirmation 2026-09-18');
  });
});

describe('historySum', () => {
  const move = (to: OrderTransition['to'], day: number) =>
    ({ to, at: `2026-09-${String(day).padStart(2, '0')}T18:00:00Z` }) as OrderTransition;

  it('lists the moves in full', () => {
    expect(historySum([move('converted', 29), move('confirmed', 30)])).toBe(
      'converted 2026-09-29 · confirmed 2026-09-30',
    );
  });
});

describe('ocLine', () => {
  const send = (overrides: Partial<QuoteSendAttempt>) =>
    ({
      messageId: '<m@x>',
      recipients: ['fixture-08@example.test'],
      audience: 'customer',
      actor: 'sales',
      submittedAt: '2026-10-02T18:00:00Z',
      outcome: 'accepted',
      unreachableHolders: [],
      ...overrides,
    }) as QuoteSendAttempt;

  it('reads the newest accepted customer send', () => {
    expect(
      ocLine([
        send({ submittedAt: '2026-10-01T18:00:00Z', recipients: ['fixture-30@example.test'] }),
        send({ recipients: ['fixture-08@example.test', 'fixture-20@example.test'] }),
        send({ submittedAt: '2026-10-05T18:00:00Z', outcome: 'failed' }),
        send({ submittedAt: '2026-10-06T18:00:00Z', audience: 'internal' }),
      ]),
    ).toEqual({ to: 'fixture-08@example.test, fixture-20@example.test', on: '2026-10-02' });
  });

  it('is null with no customer send', () => {
    expect(ocLine([send({ audience: 'internal' })])).toBeNull();
    expect(ocLine([])).toBeNull();
  });
});
