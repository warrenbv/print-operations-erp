// Builds the queue cards on Your work for each desk from the workbook in apps/web/src/lib/work/load-workbook.ts.
// Each card counts everything waiting and lists the oldest few. Whose move it is comes from
// apps/web/src/lib/work/quote-work.ts and apps/web/src/lib/work/order-work.ts: docs/product/requirements.md (R12).
import { formatMoney, quoteReference, type Order, type OrderStatus } from '@erp/types';

import { formatAge, formatDay, isLate, isUnsetTimestamp } from '../../lib/dates';
import type { Workbook } from '../../lib/work/load-workbook';
import { quotePage, type Work, type WorkDesk } from '../../lib/work/work';
import { UNKNOWN_CUSTOMER } from '../quoting/customer-names';

const CARD_ROWS = 3;

export interface CardRow {
  readonly href: string;
  readonly text: string;

  readonly age?: string;

  readonly late?: boolean;
}

export interface CardBody {
  readonly count: number;

  readonly rows: readonly CardRow[];

  readonly foot?: { readonly text: string; readonly href?: string };
}

export interface DeskCards {
  readonly cards: Readonly<Record<string, CardBody>>;

  readonly actNow: ActNow;
}

interface ActNow {
  readonly quotes: readonly string[];
  readonly orders: readonly string[];
  readonly exceptions?: readonly string[];
}

type QuoteEntry = Workbook['quotes'][number];
type OrderEntry = Workbook['orders'][number];

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

function deskName(desk: WorkDesk): string {
  return desk.replace(/^The /, '');
}

function inflect(verb: string): string {
  if (/(s|sh|ch|x|z)$/.test(verb)) return `${verb}es`;
  if (/[^aeiou]y$/.test(verb)) return `${verb.slice(0, -1)}ies`;
  return `${verb}s`;
}

export function thirdPerson(next: string): string {
  const [verb = '', ...rest] = lowerFirst(next).split(' ');
  const words = rest.map((word, index) => (rest[index - 1] === 'and' ? inflect(word) : word));
  return [inflect(verb), ...words].join(' ');
}

export function customerOf(wb: Workbook, customerId: string): string {
  return wb.customers.get(customerId)?.name ?? UNKNOWN_CUSTOMER;
}

export function orderName(wb: Workbook, order: Pick<Order, 'quoteId' | 'jobNumber'>): string {
  if (order.jobNumber !== undefined) return order.jobNumber;
  const quote = wb.quotes.find((entry) => entry.quote.id === order.quoteId)?.quote;
  return quote === undefined ? 'Order' : `Order from ${quoteReference(quote)}`;
}

export function aged(ageFrom: string, now: Date): Pick<CardRow, 'age' | 'late'> {
  if (isUnsetTimestamp(ageFrom)) return {};
  return { age: formatAge(ageFrom, now), late: isLate(ageFrom, now) };
}

export function oldestFirst<T>(items: readonly T[], since: (item: T) => string): T[] {
  return [...items].sort((a, b) => since(a).localeCompare(since(b)));
}

export function card(items: readonly CardRow[], foot?: CardBody['foot']): CardBody {
  return {
    count: items.length,
    rows: items.slice(0, CARD_ROWS),
    ...(foot === undefined ? {} : { foot }),
  };
}

function atADesk(work: Work): boolean {
  return work.group === 'yours' || work.group === 'another-desk';
}

// Keyed to the exact next-step words in apps/web/src/lib/work/quote-work.ts. Both Production desks
// see this queue: docs/product/requirements.md (R5).
function needingALeadTime(wb: Workbook): QuoteEntry[] {
  return oldestFirst(
    wb.quotes.filter((entry) => entry.work.next === 'Enter the lead time'),
    (entry) => entry.work.ageFrom,
  );
}

function leadTimeCard(wb: Workbook, now: Date): CardBody {
  return card(
    needingALeadTime(wb).map(({ quote, work }) => ({
      href: `${quotePage(quote.id)}#lead-time`,
      text: `${quoteReference(quote)} · ${customerOf(wb, quote.customerId)}`,
      ...aged(work.ageFrom, now),
    })),
    { text: 'All quotes needing a lead time', href: '/production/lead-times' },
  );
}

function ordersIn(wb: Workbook, statuses: readonly OrderStatus[]): OrderEntry[] {
  return wb.orders.filter((entry) => statuses.includes(entry.order.status));
}

function salesView(wb: Workbook, own: string | null) {
  const mine = (salesRep: string | undefined) => own === null || salesRep === own;
  return {
    quotes: wb.quotes.filter((entry) => mine(entry.quote.salesRep)),
    orders: wb.orders.filter((entry) => mine(entry.order.salesRep)),
  };
}

function withTheCustomer(wb: Workbook, own: string | null): QuoteEntry[] {
  return oldestFirst(
    salesView(wb, own).quotes.filter((entry) => entry.work.group === 'customer'),
    (entry) => entry.work.ageFrom,
  );
}

export function quotedQuoteIds(wb: Workbook, own: string | null): readonly string[] {
  return withTheCustomer(wb, own)
    .slice(0, CARD_ROWS)
    .map((entry) => entry.quote.id);
}

export function salesCards(
  wb: Workbook,
  now: Date,
  own: string | null,

  amounts: ReadonlyMap<string, string>,
): DeskCards {
  const { quotes, orders } = salesView(wb, own);

  const onYou = oldestFirst(
    quotes.filter((entry) => atADesk(entry.work) && entry.work.desk === 'Sales'),
    (entry) => entry.work.ageFrom,
  );
  const elsewhereQuotes = quotes.filter(
    (entry) => atADesk(entry.work) && entry.work.desk !== null && entry.work.desk !== 'Sales',
  );

  const unconfirmed = orders.filter((entry) => entry.order.status === 'converted');

  const elsewhere = oldestFirst(
    [
      ...elsewhereQuotes.map(({ quote, work }) => ({ name: quoteReference(quote), work })),
      ...unconfirmed.map(({ order, work }) => ({ name: orderName(wb, order), work })),
    ],
    (entry) => entry.work.ageFrom,
  );

  const confirmed = oldestFirst(
    orders.filter((entry) => entry.order.status === 'confirmed'),
    (entry) => entry.work.ageFrom,
  );

  const holds = oldestFirst(wb.creditHolds, (customer) => customer.creditHoldSetAt ?? '');

  return {
    cards: {
      'waiting-on-you': card(
        onYou.map(({ quote, work }) => ({
          href: work.href,
          text: `${quoteReference(quote)} · ${customerOf(wb, quote.customerId)}, ${lowerFirst(work.next ?? '')}`,
          ...aged(work.ageFrom, now),
        })),
        { text: 'All quotes waiting on you', href: '/quoting/quotes' },
      ),
      'waiting-on-another-desk': card(
        elsewhere.map(({ name, work }) => ({
          href: work.href,
          text:
            work.desk === null || work.next === null
              ? name
              : `${name} · ${deskName(work.desk)} ${thirdPerson(work.next)}`,
          ...aged(work.ageFrom, now),
        })),
        { text: 'You will see each one move back here when it is your turn.' },
      ),
      'quoted-with-the-customer': card(
        withTheCustomer(wb, own).map(({ quote, work }) => {
          const amount = amounts.get(quote.id);
          return {
            href: work.href,
            text: `${quoteReference(quote)} · ${customerOf(wb, quote.customerId)}${amount === undefined ? '' : `, ${formatMoney(amount)}`}`,
            ...aged(work.ageFrom, now),
          };
        }),
        { text: 'Convert one when the customer says yes.' },
      ),
      'your-customers-confirmed-orders': card(
        confirmed.map(({ order, work }) => ({
          href: work.href,
          text: `${orderName(wb, order)} · ${customerOf(wb, order.customerId)}`,
          ...aged(work.ageFrom, now),
        })),
        { text: `See all ${String(confirmed.length)} on Orders`, href: '/orders' },
      ),
      'customers-on-credit-hold': card(
        holds.map((customer) => ({
          href: `/crm/customers/${encodeURIComponent(customer.id)}`,
          text: customer.name,
          ...(customer.creditHoldSetAt === undefined
            ? {}
            : { age: `since ${formatDay(customer.creditHoldSetAt)}` }),
        })),
        { text: 'New quotes need an exception from the Billing Manager.' },
      ),
    },
    actNow: { quotes: onYou.map((entry) => entry.quote.id), orders: [] },
  };
}

export function productionManagerCards(wb: Workbook, now: Date): DeskCards {
  const toConfirm = oldestFirst(ordersIn(wb, ['converted']), (entry) => entry.work.ageFrom);
  return {
    cards: {
      'orders-to-confirm': card(
        toConfirm.map(({ order, work }) => ({
          href: work.href,
          text: `${orderName(wb, order)} · ${customerOf(wb, order.customerId)}`,
          ...aged(work.ageFrom, now),
        })),
      ),
      'quotes-needing-a-lead-time': leadTimeCard(wb, now),
    },
    actNow: {
      quotes: needingALeadTime(wb).map((entry) => entry.quote.id),
      orders: toConfirm.map((entry) => entry.order.id),
    },
  };
}

export function floorCards(wb: Workbook, now: Date): DeskCards {
  return {
    cards: {
      'quotes-needing-a-lead-time': leadTimeCard(wb, now),
    },
    actNow: {
      quotes: needingALeadTime(wb).map((entry) => entry.quote.id),
      orders: [],
    },
  };
}
