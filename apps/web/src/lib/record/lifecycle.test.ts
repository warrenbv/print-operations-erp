// Tests the step strip and Act now panel derived for quotes and orders in each state and for each desk.
import type { ErpRole, OrderStatus, OrderTransition } from '@erp/types';
import { afterAll, describe, expect, it } from 'vitest';

import type { QuoteWorkItem } from '../work/quote-work';
import {
  lifecycle as derive,
  type Lifecycle,
  type LifecycleInput,
  type OrderLifecycleInput,
  type QuoteLifecycleInput,
  type RecordGate,
  type RecordStep,
} from './lifecycle';

const NOW = new Date('2026-10-07T18:00:00.000Z');
const CHANGED = '2026-10-07T15:00:00.000Z';

const RESULTS: Lifecycle[] = [];
function lifecycle(input: LifecycleInput): Lifecycle {
  const result = derive(input);
  RESULTS.push(result);

  return { ...result, steps: result.steps.map(withoutHref) } as unknown as Lifecycle;
}

function withoutHref({ label, state, note }: RecordStep): Omit<RecordStep, 'href'> {
  return note === undefined ? { label, state } : { label, state, note };
}

function transitions(
  ...moves: readonly (readonly [OrderStatus, string, string?, string?])[]
): OrderTransition[] {
  const out: OrderTransition[] = [];
  for (const [to, day, actor, reason] of moves) {
    out.push({
      id: `t-${String(out.length + 1)}`,
      orderId: 'o-1',
      from: out.at(-1)?.to ?? null,
      to,
      actor: actor ?? 'pat',
      at: `${day}T17:00:00.000Z`,
      ...(reason === undefined ? {} : { reason }),
    });
  }
  return out;
}

const QUOTE_REF = { id: 'q-1', number: 'Q-00019', sentAt: null };

function quoteItem(overrides: Partial<QuoteWorkItem> = {}): QuoteWorkItem {
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

function quote(
  roles: readonly ErpRole[],
  record: Partial<QuoteWorkItem> = {},
  overrides: Partial<Omit<QuoteLifecycleInput, 'kind' | 'record' | 'roles'>> = {},
): Lifecycle {
  return lifecycle({
    kind: 'quote',
    record: quoteItem(record),
    orders: [],
    sentAt: null,
    productionToldAt: null,
    roles,
    now: NOW,
    ...overrides,
  });
}

function order(
  status: OrderStatus,
  roles: readonly ErpRole[],
  overrides: Partial<Omit<OrderLifecycleInput, 'record' | 'roles'>> = {},
): Lifecycle {
  return lifecycle(orderInput(status, roles, overrides));
}

function orderInput(
  status: OrderStatus,
  roles: readonly ErpRole[],
  overrides: Partial<Omit<OrderLifecycleInput, 'record' | 'roles'>> = {},
): OrderLifecycleInput {
  return {
    kind: 'order',
    record: { id: 'o-1', status, updatedAt: CHANGED },
    transitions: [],
    quote: QUOTE_REF,
    roles,
    now: NOW,
    ...overrides,
  };
}

describe('a draft quote waiting on its lead time', () => {
  const told = { productionToldAt: '2026-10-03T17:00:00.000Z' };

  it('Sales reads it as their draft, waiting on Production', () => {
    expect(quote(['Sales'], { leadTimeDays: undefined }, told)).toEqual({
      steps: [
        { label: 'Quote', state: 'current', note: 'Draft, with you' },
        { label: 'Order', state: 'gated', note: 'Needs a lead time' },
        { label: 'Confirmed', state: 'todo' },
      ],
      act: {
        tone: 'waiting',
        title: 'Waiting on Production to enter the lead time',
        who: 'Asked 2026-10-03 · 4 days',
        link: { href: '/production/lead-times', label: "Production's quote queue" },
        desk: 'Production',
      },
    });
  });

  it("Production enters it: the reader's act, at the lead-time section", () => {
    const { steps, act } = quote(['Production'], { leadTimeDays: undefined }, told);
    expect(steps[0]).toEqual({ label: 'Quote', state: 'current', note: 'Draft, with you' });
    expect(act).toEqual({
      tone: 'act',
      title: 'Enter the lead time',
      who: 'Yours to do · today',
      link: { href: '/quoting/quotes/q-1#lead-time', label: 'Go to the lead time' },
      desk: 'Production',
    });
  });

  it('with nobody told yet, the wait counts from the last change', () => {
    expect(quote(['Sales'], { leadTimeDays: undefined }).act.who).toBe('Since 2026-10-07 · today');
  });
});

describe('a quote ready to send', () => {
  const pageGates: readonly RecordGate[] = [
    { text: 'Every line is priced.', clear: true },
    { text: 'A contact receives the quote.', clear: true, href: '/quoting/quotes/q-1/customer' },
  ];

  it("is Sales' act, with the page's checklist all clear", () => {
    expect(quote(['Sales'], {}, { pageGates })).toEqual({
      steps: [
        { label: 'Quote', state: 'current', note: 'Draft, ready to send' },
        { label: 'Order', state: 'todo' },
        { label: 'Confirmed', state: 'todo' },
      ],
      act: {
        tone: 'act',
        title: 'Send the quote',
        who: 'Yours to do · today',
        link: { href: '/quoting/quotes/q-1/review', label: 'Go to Send quote' },
        gates: pageGates,
        desk: 'Sales',
      },
    });
  });
});

describe('a draft quote held short of the order', () => {
  it('a line below the floor: Sales requests approval', () => {
    const { steps, act } = quote(['Sales'], { belowFloorCount: 1 });
    expect(steps[1]).toEqual({ label: 'Order', state: 'gated', note: 'A line is below the floor' });
    expect(act).toMatchObject({
      tone: 'act',
      title: 'Request approval',
      link: { href: '/quoting/quotes/q-1/review', label: 'Go to the request' },
    });
  });

  it('a requested line below the floor waits on an Admin, on Approvals', () => {
    const { steps, act } = quote(['Sales'], { status: 'override_requested', belowFloorCount: 1 });
    expect(steps[0]).toEqual({ label: 'Quote', state: 'current', note: 'Draft, with you' });
    expect(steps[1]).toEqual({ label: 'Order', state: 'gated', note: 'A line is below the floor' });
    expect(act).toMatchObject({
      tone: 'waiting',
      title: 'Waiting on an Admin to decide the line below the floor',
      link: { href: '/approvals#price-approvals', label: 'Approvals' },
      desk: 'An Admin',
    });
    expect(
      quote(['ProductionManager'], { status: 'override_requested', belowFloorCount: 1 }).steps[0],
    ).toEqual({ label: 'Quote', state: 'current', note: 'Draft, with an Admin' });
  });

  it('a live floor override does not read as blocked by the floor', () => {
    const { steps, act } = quote(['Sales'], {
      belowFloorCount: 1,
      floorOverrideAt: '2026-10-06T10:00:00.000Z',
    });
    expect(steps[0]).toEqual({ label: 'Quote', state: 'current', note: 'Draft, ready to send' });
    expect(steps[1]).toEqual({ label: 'Order', state: 'todo' });
    expect(act).toMatchObject({ tone: 'act', title: 'Send the quote' });
  });

  it("a hand-set price waiting on the Billing Manager is Billing's act", () => {
    const { steps, act } = quote(['Billing'], {
      status: 'override_requested',
      manualCount: 1,
      manualPricePerRoll: '12.0000',
    });
    expect(steps[0]).toEqual({ label: 'Quote', state: 'current', note: 'Draft, with you' });
    expect(steps[1]).toEqual({ label: 'Order', state: 'gated', note: 'Needs price approval' });
    expect(act).toEqual({
      tone: 'act',
      title: 'Approve the hand-set price of $12.00 per roll',
      who: 'Yours to do · today',
      link: { href: '/approvals', label: 'Open Approvals' },
      desk: 'The Billing Manager',
    });
  });

  it("and the Billing Manager's queue for anyone else", () => {
    const { steps, act } = quote(['ProductionManager'], {
      status: 'override_requested',
      manualCount: 1,
      manualPricePerRoll: '12.0000',
    });
    expect(steps[0]).toEqual({
      label: 'Quote',
      state: 'current',
      note: 'Draft, with the Billing Manager',
    });
    expect(act).toMatchObject({
      tone: 'waiting',
      title: 'Waiting on the Billing Manager to approve the hand-set price of $12.00 per roll',
      link: { href: '/approvals#price-approvals', label: "The Billing Manager's approvals" },
    });
  });

  it('no lines yet', () => {
    expect(quote(['Sales'], { lineCount: 0 }).steps[1]).toEqual({
      label: 'Order',
      state: 'gated',
      note: 'Needs a priced line',
    });
  });
});

describe('a quote with the customer', () => {
  it('waits on the customer, and anyone may convert it', () => {
    expect(quote(['Sales'], { status: 'quoted' }, { sentAt: '2026-10-03T17:00:00.000Z' })).toEqual({
      steps: [
        { label: 'Quote', state: 'current', note: 'With the customer, 4 days' },
        { label: 'Order', state: 'todo' },
        { label: 'Confirmed', state: 'todo' },
      ],
      act: {
        tone: 'waiting',
        title: 'Waiting on the customer',
        who: 'Sent 2026-10-03 · 4 days',
        link: { href: '/quoting/quotes/q-1/convert', label: 'Convert this quote' },
        desk: null,
      },
    });
  });
});

describe('a quote with orders', () => {
  const withOrders = (roles: readonly ErpRole[], count: number) =>
    quote(
      roles,
      { status: 'quoted' },
      {
        orders: Array.from({ length: count }, (_, i) => ({ id: `o-${String(i + 1)}` })),
        sentAt: '2026-10-03T17:00:00.000Z',
      },
    );

  it('stands at Quote as a quote with none does, counting its orders', () => {
    expect(withOrders(['Sales'], 2)).toEqual({
      steps: [
        { label: 'Quote', state: 'current', note: 'Quoted, 2 orders so far' },
        { label: 'Order', state: 'todo' },
        { label: 'Confirmed', state: 'todo' },
      ],
      act: {
        tone: 'waiting',
        title: 'Waiting on the customer',
        who: 'Sent 2026-10-03 · 4 days',
        link: { href: '/quoting/quotes/q-1/convert', label: 'Create another order' },
        desk: null,
      },
    });
    expect(withOrders(['Sales'], 1).steps[0]?.note).toBe('Quoted, 1 order so far');
  });

  it('never follows an order, for any reader: each order has its own strip', () => {
    for (const roles of [['ProductionManager'], ['Billing'], ['Admin']] as const) {
      const { steps, act } = withOrders(roles, 1);
      expect(steps.filter((step) => step.state === 'current').map((step) => step.label)).toEqual([
        'Quote',
      ]);
      expect(act.link?.label).toBe('Create another order');
    }
  });

  it('superseded, it says how many orders it has, off the line', () => {
    const { steps, act } = quote(
      ['Sales'],
      { status: 'superseded' },
      { orders: [{ id: 'o-1' }, { id: 'o-2' }] },
    );
    expect(steps[0]).toEqual({ label: 'Quote', state: 'na', note: 'Superseded, 2 orders' });
    expect(steps.slice(1).every((step) => step.state === 'na')).toBe(true);
    expect(act).toMatchObject({ tone: 'done', title: 'Superseded' });
  });
});

describe('a closed quote', () => {
  const na = (quoteNote: string) => [
    { label: 'Quote', state: 'na', note: quoteNote },
    { label: 'Order', state: 'na' },
    { label: 'Confirmed', state: 'na' },
  ];

  it('closed as lost', () => {
    expect(quote(['Sales'], { status: 'closed_lost' })).toEqual({
      steps: na('Closed (lost)'),
      act: {
        tone: 'done',
        title: 'Closed (lost)',
        who: 'Closed as lost on 2026-10-07. Nothing is left to do.',
        desk: null,
      },
    });
  });

  it('superseded', () => {
    expect(quote(['Sales'], { status: 'superseded' })).toEqual({
      steps: na('Superseded'),
      act: {
        tone: 'done',
        title: 'Superseded',
        who: 'Replaced by a newer version on 2026-10-07. Nothing is left to do.',
        desk: null,
      },
    });
  });
});

describe('a converted order', () => {
  const at05 = (roles: readonly ErpRole[]) =>
    order('converted', roles, {
      transitions: transitions(['converted', '2026-09-18']),
      quote: { id: 'q-1', number: 'Q-00019', sentAt: '2026-09-12T17:00:00.000Z' },
    });
  const rest = [{ label: 'Confirmed', state: 'todo' }];

  it('the Production Manager confirms it', () => {
    expect(at05(['ProductionManager'])).toEqual({
      steps: [
        { label: 'Quote', state: 'done', note: 'Sent 2026-09-12' },
        { label: 'Order', state: 'current', note: 'With you, 19 days' },
        ...rest,
      ],
      act: {
        tone: 'act',
        title: 'Confirm the order',
        who: 'Yours to do · waiting 19 days',
        link: { href: '/orders/o-1#confirmation', label: 'Confirm the order' },
        gates: [
          { text: 'Converted from a quoted quote by pat on 2026-09-18.', clear: true },
          { text: 'No PO recorded. It is not needed to confirm.', clear: true },
        ],
        desk: 'The Production Manager',
      },
    });
  });

  it('Sales waits on the Production Manager', () => {
    expect(at05(['Sales'])).toEqual({
      steps: [
        { label: 'Quote', state: 'done', note: 'Sent 2026-09-12' },
        { label: 'Order', state: 'current', note: 'With the Production Manager, 19 days' },
        ...rest,
      ],
      act: {
        tone: 'waiting',
        title: 'Waiting on the Production Manager to confirm the order',
        who: 'Since 2026-09-18 · 19 days',
        link: { href: '/orders', label: "Production Manager's queue" },
        desk: 'The Production Manager',
      },
    });
  });
});

describe('a confirmed order', () => {
  it('ends the strip at Confirmed, with nothing left to do in this edition', () => {
    for (const roles of [['Sales'], ['Production'], ['ProductionManager']] as const) {
      expect(
        order('confirmed', roles, {
          transitions: transitions(['converted', '2026-09-29'], ['confirmed', '2026-10-02']),
        }),
      ).toEqual({
        steps: [
          { label: 'Quote', state: 'done', note: 'Q-00019' },
          { label: 'Order', state: 'done', note: '2026-09-29' },
          { label: 'Confirmed', state: 'done', note: '2026-10-02' },
        ],
        act: {
          tone: 'done',
          title: 'Confirmed',
          who: 'Production, shipping and invoicing are outside this edition.',
          desk: null,
        },
      });
    }
  });
});

describe('Admin alone', () => {
  it("acts on every desk's act, and the panel still names the desk", () => {
    expect(order('converted', ['Admin']).act).toMatchObject({
      tone: 'act',
      title: 'Confirm the order',
      desk: 'The Production Manager',
    });
  });
});

const RECORDS = {
  Quote: '/quoting/quotes/q-1',
  Order: '/orders/o-1',
  Confirmed: '/orders/o-1',
} as const;

function hrefs({ steps }: Lifecycle): (string | undefined)[] {
  return steps.map((step) => step.href);
}

describe('step links', () => {
  afterAll(() => {
    expect(RESULTS.length).toBeGreaterThan(10);
    for (const result of RESULTS) {
      expect(result.steps).toHaveLength(3);
      for (const step of result.steps) {
        if (step.state === 'done' || step.state === 'current') {
          expect([RECORDS[step.label], undefined]).toContain(step.href);
        } else expect(step.href).toBeUndefined();
      }
    }
  });

  it('on a converted order: Order is current and opens the order itself', () => {
    expect(hrefs(derive(orderInput('converted', ['Sales'])))).toEqual([
      RECORDS.Quote,
      RECORDS.Order,
      undefined,
    ]);
  });

  it('on a confirmed order: every step opens its record', () => {
    expect(
      hrefs(
        derive(
          orderInput('confirmed', ['Sales'], {
            transitions: transitions(['converted', '2026-09-29'], ['confirmed', '2026-10-02']),
          }),
        ),
      ),
    ).toEqual(Object.values(RECORDS));
  });

  it('with the quote unknown, the Quote step has no link', () => {
    expect(
      hrefs(derive(orderInput('converted', ['Sales'], { quote: { ...QUOTE_REF, id: null } })))[0],
    ).toBeUndefined();
  });

  it('on a draft quote: Quote is current and opens the quote; the later steps have no link', () => {
    expect(hrefs(derive(quoteInput()))).toEqual([RECORDS.Quote, undefined, undefined]);
  });

  it('on a quote with orders: Quote is current and opens the quote, the later steps no link', () => {
    const withOrders = derive({
      ...quoteInput(),
      record: quoteItem({ status: 'quoted' }),
      orders: [{ id: 'o-0' }, { id: 'o-1' }],
      sentAt: '2026-09-12T17:00:00.000Z',
    });
    expect(hrefs(withOrders)).toEqual([RECORDS.Quote, undefined, undefined]);
  });
});

function quoteInput(): QuoteLifecycleInput {
  return {
    kind: 'quote',
    record: quoteItem(),
    orders: [],
    sentAt: null,
    productionToldAt: null,
    roles: ['Sales'],
    now: NOW,
  };
}
