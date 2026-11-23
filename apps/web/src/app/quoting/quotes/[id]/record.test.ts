// Tests the quote record view: its work item, send times, chip, panel and orders table.
import { describe, expect, it } from 'vitest';

import type { ErpRole, Order, QuoteSendAttempt, QuoteWithLines } from '@erp/types';

import type { RecordAct } from '../../../../lib/record/lifecycle';
import {
  customerSentAt,
  missingDocumentRows,
  orderLineWords,
  productionToldAt,
  quoteChip,
  quoteOrderRows,
  quotePanel,
  quoteStrip,
  quoteWorkItem,
  type QuoteOrderLine,
} from './record';

const NOW = new Date('2026-10-07T18:00:00.000Z');
const SALES: readonly ErpRole[] = ['Sales'];
const PRODUCTION_MANAGER: readonly ErpRole[] = ['ProductionManager'];

type Line = QuoteWithLines['lines'][number];

function line(lineNumber: number, overrides: Partial<Line> = {}): Line {
  return {
    lineNumber,
    priceSource: 'tier',
    pricePerRoll: '10.00',
    floor: { status: 'ok' },
    ...overrides,
  } as Line;
}

function quote(overrides: Partial<QuoteWithLines> = {}): QuoteWithLines {
  return {
    id: 'q-1',
    status: 'draft',
    leadTimeDays: undefined,
    overrideApprovedAt: undefined,
    updatedAt: '2026-10-07T15:00:00.000Z',
    lines: [],
    ...overrides,
  } as QuoteWithLines;
}

function send(overrides: Partial<QuoteSendAttempt>): QuoteSendAttempt {
  return {
    messageId: 'm',
    recipients: ['fixture-21@example.test'],
    audience: 'customer',
    actor: 'dev-sales',
    submittedAt: '2026-10-02T16:00:00.000Z',
    outcome: 'accepted',
    unreachableHolders: [],
    ...overrides,
  };
}

const WAITING: RecordAct = {
  tone: 'waiting',
  title: 'Waiting on the customer',
  who: 'Sent 2026-10-02 · 5 days',
  desk: null,
};

describe('quoteWorkItem', () => {
  it('counts the lines as the list item does', () => {
    const item = quoteWorkItem(
      quote({
        lines: [
          line(2, { priceSource: 'manual', pricePerRoll: '12.00' }),
          line(1, { floor: { status: 'below_floor' } as Line['floor'] }),
          line(3, { priceSource: 'manual', pricePerRoll: '19.40' }),
        ],
      }),
    );
    expect(item.lineCount).toBe(3);
    expect(item.belowFloorCount).toBe(1);
    expect(item.manualCount).toBe(2);

    expect(item.manualPricePerRoll).toBe('12.00');
  });

  it('says null when no line is hand-set', () => {
    expect(quoteWorkItem(quote({ lines: [line(1)] })).manualPricePerRoll).toBeNull();
  });

  it('carries a live floor override, so the strip does not read the floor as blocking', () => {
    const overridden = quote({
      floorOverrideAt: '2026-10-07T16:00:00.000Z',
      lines: [line(1, { floor: { status: 'below_floor' } as Line['floor'] })],
    });
    expect(quoteWorkItem(overridden).floorOverrideAt).toBe('2026-10-07T16:00:00.000Z');
    expect(quoteWorkItem(overridden).belowFloorCount).toBe(1);
    expect(quoteWorkItem(quote()).floorOverrideAt).toBeUndefined();
  });
});

describe('customerSentAt', () => {
  it('is the earliest accepted copy to the customer', () => {
    const sends = [
      send({ submittedAt: '2026-10-05T16:00:00.000Z' }),
      send({ submittedAt: '2026-10-03T16:00:00.000Z' }),
    ];
    expect(customerSentAt(sends)).toBe('2026-10-03T16:00:00.000Z');
  });

  it('ignores failed attempts, internal alerts and the lead-time request', () => {
    const sends = [
      send({ outcome: 'failed', submittedAt: '2026-10-01T16:00:00.000Z' }),
      send({ audience: 'internal', submittedAt: '2026-09-30T16:00:00.000Z' }),
      send({ kind: 'lead-time-request', submittedAt: '2026-09-29T16:00:00.000Z' }),
    ];
    expect(customerSentAt(sends)).toBeNull();
    expect(customerSentAt([send({}), ...sends])).toBe('2026-10-02T16:00:00.000Z');
  });
});

describe('productionToldAt', () => {
  it('is the newest lead-time request, accepted or not', () => {
    const sends = [
      send({
        kind: 'lead-time-request',
        outcome: 'failed',
        submittedAt: '2026-10-04T16:00:00.000Z',
      }),
      send({ kind: 'lead-time-request', submittedAt: '2026-10-01T16:00:00.000Z' }),
      send({}),
    ];
    expect(productionToldAt(sends)).toBe('2026-10-04T16:00:00.000Z');
    expect(productionToldAt([send({})])).toBeNull();
  });
});

describe('quoteChip', () => {
  it('reads Quoted, pending, without an order', () => {
    expect(quoteChip('quoted', 0)).toEqual({ label: 'Quoted', tone: 'pending' });
  });

  it('reads its status and how many orders, never Converted', () => {
    expect(quoteChip('quoted', 1)).toEqual({ label: 'Quoted, 1 order so far', tone: 'pending' });
    expect(quoteChip('quoted', 2)).toEqual({ label: 'Quoted, 2 orders so far', tone: 'pending' });
    expect(quoteChip('superseded', 2)).toEqual({ label: 'Superseded, 2 orders', tone: 'neutral' });
    expect(quoteChip('superseded', 1)).toEqual({ label: 'Superseded, 1 order', tone: 'neutral' });
  });

  it('reads Superseded and Closed (lost) neutral', () => {
    expect(quoteChip('superseded', 0)).toEqual({ label: 'Superseded', tone: 'neutral' });
    expect(quoteChip('closed_lost', 0)).toEqual({ label: 'Closed (lost)', tone: 'neutral' });
  });
});

describe('quotePanel', () => {
  const base = { orders: [], act: WAITING };

  const twoOrders = [
    { createdAt: '2026-10-06T16:00:00.000Z' },
    { createdAt: '2026-10-01T16:00:00.000Z' },
  ];

  it("is Sales' Convert to order on a quoted quote, when the customer says yes", () => {
    expect(quotePanel({ ...base, status: 'quoted', canWrite: true })).toEqual({
      variant: 'convert',
      tone: 'act',
      title: 'Convert to order',
      who: 'When the customer says yes · Sent 2026-10-02 · 5 days',
    });
  });

  it('waits on the customer for everyone else', () => {
    expect(quotePanel({ ...base, status: 'quoted', canWrite: false })).toEqual({
      variant: 'waiting',
      tone: 'waiting',
      title: 'Waiting on the customer',
      who: 'Sent 2026-10-02 · 5 days',
    });
  });

  it('heads a quoted quote with orders by its count, the act every reader has', () => {
    for (const canWrite of [true, false]) {
      expect(quotePanel({ ...base, status: 'quoted', canWrite, orders: twoOrders })).toEqual({
        variant: 'orders',
        tone: 'act',
        title: 'Quoted, 2 orders so far',
        who: 'Last order 2026-10-06',
      });
    }
    expect(
      quotePanel({ ...base, status: 'quoted', canWrite: true, orders: twoOrders.slice(1) }).title,
    ).toBe('Quoted, 1 order so far');
  });

  it('heads a superseded quote with orders by its count, done', () => {
    expect(
      quotePanel({ ...base, status: 'superseded', canWrite: true, orders: twoOrders }),
    ).toEqual({
      variant: 'orders',
      tone: 'done',
      title: 'Superseded, 2 orders',
      who: 'Last order 2026-10-06',
    });
  });

  it("takes the derivation's done panel for a superseded or lost quote", () => {
    const superseded: RecordAct = {
      tone: 'done',
      title: 'Superseded',
      who: 'Replaced by a newer version on 2026-10-06. Nothing is left to do.',
      desk: null,
    };
    expect(quotePanel({ ...base, status: 'superseded', canWrite: true, act: superseded })).toEqual({
      variant: 'superseded',
      tone: 'done',
      title: 'Superseded',
      who: superseded.who,
    });
    const closed: RecordAct = {
      tone: 'done',
      title: 'Closed (lost)',
      who: 'Closed as lost on 2026-10-06. Nothing is left to do.',
      desk: null,
    };
    expect(quotePanel({ ...base, status: 'closed_lost', canWrite: true, act: closed })).toEqual({
      variant: 'closed',
      tone: 'done',
      title: 'Closed (lost)',
      who: closed.who,
    });
  });
});

describe('Orders from this quote', () => {
  function order(id: string, createdAt: string, overrides: Partial<Order> = {}): Order {
    return {
      id,
      status: 'converted',
      createdAt: `${createdAt}T17:00:00.000Z`,
      ...overrides,
    } as Order;
  }

  it('says each line and its quantity, with the pounds on a per-pound line', () => {
    expect(orderLineWords({ lineNumber: 1, quantityRolls: 40, pricingBasis: 'per_roll' })).toBe(
      'Line 1: 40 rolls',
    );
    expect(orderLineWords({ lineNumber: 3, quantityRolls: 1, pricingBasis: 'per_roll' })).toBe(
      'Line 3: 1 roll',
    );
    expect(
      orderLineWords({
        lineNumber: 2,
        quantityRolls: 12,
        pricingBasis: 'per_pound',
        orderedWeightLb: '4850.0000',
      }),
    ).toBe('Line 2: 12 rolls, 4,850 lb');
  });

  it('runs by delivery date, soonest first, then the undated ones, newest first', () => {
    const rows = quoteOrderRows({
      orders: [
        order('undated-new', '2026-11-05'),
        order('july', '2026-11-04', { requestedDate: '2027-07-15' }),
        order('undated-old', '2026-11-01', { status: 'confirmed' }),
        order('june', '2026-11-02', { requestedDate: '2027-06-10' }),
      ],
      quoteRef: 'Q-00036',
      lines: new Map(),
    });
    expect(rows.map((row) => row.id)).toEqual(['june', 'july', 'undated-new', 'undated-old']);

    expect(rows.at(-1)?.status).toBe('Confirmed');
  });

  it('words a row: its name, PO, date, lines and status', () => {
    const [confirmed, unconfirmed] = quoteOrderRows({
      orders: [
        order('o-1', '2026-11-01'),
        order('o-2', '2026-11-02', {
          jobNumber: 'DPW-00527',
          poNumber: '7716402',
          requestedDate: '2027-06-10',
          status: 'confirmed',
        }),
      ],
      quoteRef: 'Q-00036',
      lines: new Map<string, readonly QuoteOrderLine[]>([
        [
          'o-2',
          [
            { lineNumber: 2, quantityRolls: 30, pricingBasis: 'per_roll' },
            { lineNumber: 1, quantityRolls: 40, pricingBasis: 'per_roll' },
          ],
        ],
      ]),
    });
    expect(confirmed).toEqual({
      id: 'o-2',
      href: '/orders/o-2',
      name: 'DPW-00527',
      poNumber: '7716402',
      deliveryDate: '2027-06-10',
      lines: ['Line 1: 40 rolls', 'Line 2: 30 rolls'],
      status: 'Confirmed',
    });
    expect(unconfirmed).toEqual({
      id: 'o-1',
      href: '/orders/o-1',
      name: 'Order from Q-00036',
      poNumber: 'None',
      deliveryDate: 'None given',
      lines: [],
      status: 'Converted',
    });
  });
});

describe('quoteStrip', () => {
  const current = (steps: ReturnType<typeof quoteStrip>) =>
    steps.find((step) => step.state === 'current');

  it('reads Draft, with you for Sales while lines are missing', () => {
    const steps = quoteStrip({ quote: quote(), roles: SALES, now: NOW });
    expect(steps).toHaveLength(3);
    expect(current(steps)).toMatchObject({ label: 'Quote', note: 'Draft, with you' });
  });

  it('reads Draft, with you for the Production Manager when the lead time is theirs', () => {
    const steps = quoteStrip({
      quote: quote({ lines: [line(1)] }),
      roles: PRODUCTION_MANAGER,
      now: NOW,
    });
    expect(current(steps)).toMatchObject({ label: 'Quote', note: 'Draft, with you' });
  });

  it('reads Draft, ready to send once only the send is left', () => {
    const steps = quoteStrip({
      quote: quote({ lines: [line(1)], leadTimeDays: 10 }),
      roles: SALES,
      now: NOW,
    });
    expect(current(steps)).toMatchObject({ label: 'Quote', note: 'Draft, ready to send' });
  });
});

describe('the orders a press left without the PO document', () => {
  const order = (id: string, requestedDate: string, jobNumber?: string): Order =>
    ({
      id,
      status: 'converted',
      createdAt: '2026-11-16T17:00:00.000Z',
      requestedDate,
      ...(jobNumber === undefined ? {} : { jobNumber }),
    }) as Order;
  const orders = [
    order('july', '2027-07-15'),
    order('june', '2027-06-10'),
    order('older', '2027-01-05', 'DPW-00194'),
  ];

  it('names each, by delivery date, as a link to its Documents fold', () => {
    expect(missingDocumentRows('july,june', orders, 'Q-00036')).toEqual([
      {
        id: 'june',
        href: '/orders/june?field=documents#documents',
        name: 'Order from Q-00036, delivery 2027-06-10',
      },
      {
        id: 'july',
        href: '/orders/july?field=documents#documents',
        name: 'Order from Q-00036, delivery 2027-07-15',
      },
    ]);
  });

  it('names nothing this quote has no order for, and nothing when there is no key', () => {
    expect(missingDocumentRows('elsewhere', orders, 'Q-00036')).toEqual([]);
    expect(missingDocumentRows(undefined, orders, 'Q-00036')).toEqual([]);
    expect(missingDocumentRows(['june', 'july'], orders, 'Q-00036')).toEqual([]);
  });
});
