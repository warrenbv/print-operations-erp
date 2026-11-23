// Tests the queue cards for the Sales, Production Manager and Production desks.
import type { Customer, Order } from '@erp/types';
import { describe, expect, it } from 'vitest';

import type { Workbook } from '../../lib/work/load-workbook';
import type { Work } from '../../lib/work/work';
import {
  floorCards,
  orderName,
  productionManagerCards,
  quotedQuoteIds,
  salesCards,
  thirdPerson,
} from './cards';

const NOW = new Date('2026-10-07T21:10:00.000Z');
const TODAY = '2026-10-07T16:00:00.000Z';
const DAYS_AGO_2 = '2026-10-05T16:00:00.000Z';
const DAYS_AGO_19 = '2026-09-18T16:00:00.000Z';

type QuoteEntry = Workbook['quotes'][number];
type OrderEntry = Workbook['orders'][number];

function work(overrides: Partial<Work>): Work {
  return {
    group: 'another-desk',
    next: null,
    with: null,
    desk: null,
    ageFrom: TODAY,
    href: '/somewhere',
    ...overrides,
  };
}

function quote(id: string, quoteNumber: number, w: Partial<Work>, salesRep?: string): QuoteEntry {
  return {
    quote: {
      id,
      quoteNumber,
      versionNumber: 1,
      customerId: 'c-1',
      ...(salesRep === undefined ? {} : { salesRep }),
    } as QuoteEntry['quote'],
    work: work(w),
  };
}

function order(
  id: string,
  fields: Partial<Order> & Pick<Order, 'status'>,
  w: Partial<Work> = {},
): OrderEntry {
  return {
    order: { id, quoteId: 'q-6', customerId: 'c-1', ...fields } as Order,
    work: work(w),
  };
}

function workbook(fields: Partial<Workbook>): Workbook {
  return {
    quotes: [],
    orders: [],
    approvals: [],
    creditHolds: [],
    customers: new Map([['c-1', { id: 'c-1', name: 'Juniper Demo Foods' } as Customer]]),
    ...fields,
  } as Workbook;
}

const CONVERTED_QUOTE = quote('q-6', 38, { group: 'converted' });

describe('the words', () => {
  it('puts the act in the third person, both verbs of a pair', () => {
    expect(thirdPerson('Confirm the order')).toBe('confirms the order');
    expect(thirdPerson('Enter the lead time')).toBe('enters the lead time');
    expect(thirdPerson('Price the lines and send the quote')).toBe(
      'prices the lines and sends the quote',
    );
  });

  it('names an order from its quote before confirmation, by its job number after', () => {
    const wb = workbook({ quotes: [CONVERTED_QUOTE] });
    expect(orderName(wb, { quoteId: 'q-6', jobNumber: undefined })).toBe('Order from Q-00038');
    expect(orderName(wb, { quoteId: 'q-6', jobNumber: 'DPW-00418' })).toBe('DPW-00418');
  });
});

describe('salesCards', () => {
  const emptyDraft = quote(
    'q-23',
    57,
    {
      group: 'yours',
      next: 'Add the first line',
      with: 'You',
      desk: 'Sales',
      ageFrom: DAYS_AGO_2,
      href: '/quoting/quotes/q-23#lines',
    },
    'jordan',
  );
  const leadTime = quote(
    'q-1',
    14,
    { next: 'Enter the lead time', with: 'Production', desk: 'Production', ageFrom: TODAY },
    'jordan',
  );
  const quoted = quote(
    'q-2',
    29,
    { group: 'customer', with: 'Customer', href: '/quoting/quotes/q-2/convert' },
    'jordan',
  );
  const someoneElses = quote(
    'q-9',
    9,
    { group: 'yours', next: 'Send the quote', with: 'You', desk: 'Sales' },
    'demo-sales-d',
  );
  const unconfirmed = order(
    'o-6',
    { status: 'converted', salesRep: 'jordan' },
    {
      next: 'Confirm the order',
      with: 'The Production Manager',
      desk: 'The Production Manager',
      ageFrom: DAYS_AGO_19,
      href: '/orders/o-6',
    },
  );
  const confirmed = order(
    'o-1',
    { status: 'confirmed', jobNumber: 'DPW-00418', salesRep: 'jordan' },
    { group: 'done', next: null, with: null, desk: null, href: '/orders/o-1' },
  );
  const wb = workbook({
    quotes: [emptyDraft, leadTime, quoted, someoneElses, CONVERTED_QUOTE],
    orders: [unconfirmed, confirmed],
  });

  it('Waiting on you: the Sales act, "{quote} · {customer}, {act}", to the step', () => {
    const { cards, actNow } = salesCards(wb, NOW, 'jordan', new Map());
    expect(cards['waiting-on-you']).toEqual({
      count: 1,
      rows: [
        {
          href: '/quoting/quotes/q-23#lines',
          text: 'Q-00057 · Juniper Demo Foods, add the first line',
          age: '2 days',
          late: false,
        },
      ],
      foot: { text: 'All quotes waiting on you', href: '/quoting/quotes' },
    });
    expect(actNow).toEqual({ quotes: ['q-23'], orders: [] });
  });

  it('Waiting on another desk: quotes and unconfirmed orders, oldest first, late in amber', () => {
    const card = salesCards(wb, NOW, 'jordan', new Map()).cards['waiting-on-another-desk'];
    expect(card?.rows.map((row) => [row.text, row.age, row.late])).toEqual([
      ['Order from Q-00038 · Production Manager confirms the order', '19 days', true],
      ['Q-00014 · Production enters the lead time', 'today', false],
    ]);
    expect(card?.foot).toEqual({
      text: 'You will see each one move back here when it is your turn.',
    });
  });

  it('Quoted, with the customer: the amount the page read for the row', () => {
    expect(quotedQuoteIds(wb, 'jordan')).toEqual(['q-2']);
    const card = salesCards(wb, NOW, 'jordan', new Map([['q-2', '657.3100']])).cards[
      'quoted-with-the-customer'
    ];
    expect(card?.rows[0]).toMatchObject({
      href: '/quoting/quotes/q-2/convert',
      text: 'Q-00029 · Juniper Demo Foods, $657.31',
    });
  });

  it("Your customers' confirmed orders: the job number and the customer", () => {
    const card = salesCards(wb, NOW, 'jordan', new Map()).cards['your-customers-confirmed-orders'];
    expect(card?.rows[0]?.text).toBe('DPW-00418 · Juniper Demo Foods');
    expect(card?.foot).toEqual({ text: 'See all 1 on Orders', href: '/orders' });
  });

  it('an offerable rep sees their own records only; anyone else sees every one', () => {
    expect(salesCards(wb, NOW, 'jordan', new Map()).cards['waiting-on-you']?.count).toBe(1);
    expect(salesCards(wb, NOW, null, new Map()).cards['waiting-on-you']?.count).toBe(2);
  });

  it('an Admin-alone reader gets the same split: by the desk, not by "You"', () => {
    const adminView = workbook({
      quotes: [
        quote('q-1', 14, {
          group: 'yours',
          next: 'Enter the lead time',
          with: 'You',
          desk: 'Production',
        }),
      ],
    });
    const { cards } = salesCards(adminView, NOW, null, new Map());
    expect(cards['waiting-on-you']?.count).toBe(0);
    expect(cards['waiting-on-another-desk']?.rows[0]?.text).toBe(
      'Q-00014 · Production enters the lead time',
    );
  });

  it('Customers on credit hold: since the day the hold was set', () => {
    const held = {
      id: 'c-9',
      name: 'Cedar Demo Outfitters',
      creditHold: true,
      creditHoldSetAt: '2026-09-29T18:00:00.000Z',
    } as Customer;
    const card = salesCards(workbook({ creditHolds: [held] }), NOW, null, new Map()).cards[
      'customers-on-credit-hold'
    ];
    expect(card?.rows).toEqual([
      { href: '/crm/customers/c-9', text: 'Cedar Demo Outfitters', age: 'since 2026-09-29' },
    ]);
  });

  it('shows three rows and counts them all', () => {
    const many = workbook({
      quotes: [1, 2, 3, 4, 5].map((n) =>
        quote(`q-${String(n)}`, n, {
          group: 'yours',
          next: 'Send the quote',
          with: 'You',
          desk: 'Sales',
        }),
      ),
    });
    const card = salesCards(many, NOW, null, new Map()).cards['waiting-on-you'];
    expect(card?.count).toBe(5);
    expect(card?.rows).toHaveLength(3);
  });
});

describe('productionManagerCards', () => {
  const unconfirmed = order(
    'o-6',
    { status: 'converted' },
    { group: 'yours', next: 'Confirm the order', with: 'You', href: '/orders/o-6#confirmation' },
  );
  const proofJob = order('o-2', { status: 'confirmed', jobNumber: 'DPW-00426' });
  const wb = workbook({
    quotes: [
      CONVERTED_QUOTE,
      quote('q-1', 14, { next: 'Enter the lead time', desk: 'Production' }),
    ],
    orders: [unconfirmed, proofJob],
  });
  const { cards, actNow } = productionManagerCards(wb, NOW);

  it('Orders to confirm opens the confirmation step', () => {
    expect(cards['orders-to-confirm']?.rows[0]).toMatchObject({
      href: '/orders/o-6#confirmation',
      text: 'Order from Q-00038 · Juniper Demo Foods',
    });
  });

  it('Quotes needing a lead time opens the lead-time section', () => {
    expect(cards['quotes-needing-a-lead-time']).toMatchObject({
      count: 1,
      rows: [{ href: '/quoting/quotes/q-1#lead-time', text: 'Q-00014 · Juniper Demo Foods' }],
      foot: { text: 'All quotes needing a lead time', href: '/production/lead-times' },
    });
  });

  it('every card is act-now for the lede', () => {
    expect(actNow).toEqual({ quotes: ['q-1'], orders: ['o-6'] });
  });
});

describe('floorCards', () => {
  const wb = workbook({
    quotes: [quote('q-1', 14, { next: 'Enter the lead time', desk: 'Production' })],
  });
  const { cards, actNow } = floorCards(wb, NOW);

  it('leads with the quotes needing a lead time', () => {
    expect(cards['quotes-needing-a-lead-time']?.count).toBe(1);
  });

  it('holds nothing but that queue', () => {
    expect(Object.keys(cards)).toEqual(['quotes-needing-a-lead-time']);
    expect(actNow).toEqual({ quotes: ['q-1'], orders: [] });
  });
});
