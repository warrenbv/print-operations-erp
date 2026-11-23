// Reads what Your work and the list pages need in one pass: quotes, orders, pending approvals and credit holds,
// each record with its work row. A read the reader's roles may not make comes back empty and is listed in `refused`,
// so one refused list does not blank the page.
import {
  CUSTOMER_SEARCH_MAX_LIMIT,
  customerSearchResponseSchema,
  orderListResponseSchema,
  pendingApprovalListResponseSchema,
  quoteListResponseSchema,
  type Customer,
  type Order,
  type PendingApproval,
  type Quote,
  type QuoteListItem,
  type SessionUser,
} from '@erp/types';

import { loadCustomerRecords } from '../../app/quoting/customer-names';
import { fetchParsed } from '../fetch-parsed';
import { orderWork } from './order-work';
import { quoteWork } from './quote-work';
import type { Work } from './work';

// Orders grouped by their quote, oldest first, so the last of each list is the newest order.
export function ordersByQuote(orders: readonly Order[]): ReadonlyMap<string, readonly Order[]> {
  const byQuote = new Map<string, Order[]>();
  const oldestFirst = [...orders].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  for (const order of oldestFirst) {
    const list = byQuote.get(order.quoteId) ?? [];
    list.push(order);
    byQuote.set(order.quoteId, list);
  }
  return byQuote;
}

export function customerIdsOf(
  quotes: readonly Pick<Quote, 'customerId'>[],
  orders: readonly Pick<Order, 'customerId'>[],
  approvals: readonly PendingApproval[],
): readonly string[] {
  return [
    ...new Set([
      ...quotes.map((quote) => quote.customerId),
      ...orders.map((order) => order.customerId),
      ...approvals.map((approval) => approval.customerId),
    ]),
  ];
}

export interface ListRead<T> {
  readonly path: string;

  readonly value: T | null;
  readonly empty: T;
}

export function listRead<T>(path: string, value: T | null, empty: T): ListRead<T> {
  return { path, value, empty };
}

export function settleReads<R extends Readonly<Record<string, ListRead<unknown>>>>(
  reads: R,
): {
  readonly lists: { readonly [K in keyof R]: R[K]['empty'] };
  readonly refused: readonly string[];
} {
  const lists: Record<string, unknown> = {};
  const refused: string[] = [];
  for (const [name, read] of Object.entries(reads)) {
    if (read.value === null) refused.push(read.path);
    lists[name] = read.value ?? read.empty;
  }
  return { lists: lists as { readonly [K in keyof R]: R[K]['empty'] }, refused };
}

const REFUSED_IS_NULL = { forbidden: 'null' } as const;

const NO_ITEMS = { items: [] };

export interface Workbook {
  readonly me: SessionUser;
  readonly quotes: readonly { readonly quote: QuoteListItem; readonly work: Work }[];
  readonly orders: readonly { readonly order: Order; readonly work: Work }[];
  readonly approvals: readonly PendingApproval[];

  readonly creditHolds: readonly Customer[];

  readonly customers: ReadonlyMap<string, Customer>;

  readonly refused: readonly string[];
}

export async function loadWorkbook(me: SessionUser, now: Date = new Date()): Promise<Workbook> {
  // A reader with the Sales role sees holds on their own accounts. Other desks see every hold.
  const allHolds = `/crm/customers?creditHold=true&limit=${String(CUSTOMER_SEARCH_MAX_LIMIT)}`;
  const holdsPath = me.roles.includes('Sales')
    ? `${allHolds}&accountRepUsername=${encodeURIComponent(me.username)}`
    : allHolds;

  const [quoteRead, orderRead, approvalsRead, holdsRead] = await Promise.all([
    fetchParsed('/quoting/quotes', quoteListResponseSchema, REFUSED_IS_NULL),
    fetchParsed('/orders', orderListResponseSchema, REFUSED_IS_NULL),
    fetchParsed('/approvals/pending', pendingApprovalListResponseSchema, REFUSED_IS_NULL),
    fetchParsed(holdsPath, customerSearchResponseSchema, REFUSED_IS_NULL),
  ]);

  const { lists, refused } = settleReads({
    quoteList: listRead('/quoting/quotes', quoteRead, NO_ITEMS),
    orderList: listRead('/orders', orderRead, NO_ITEMS),
    approvals: listRead('/approvals/pending', approvalsRead, NO_ITEMS),
    holds: listRead(holdsPath, holdsRead, { items: [], total: 0 }),
  });
  const { quoteList, orderList, approvals, holds } = lists;

  const creditHolds = holds.items.filter((customer) => customer.creditHold);

  const customers = await loadCustomerRecords(
    customerIdsOf(quoteList.items, orderList.items, approvals.items),
  );

  const orders = orderList.items.map((order) => ({
    order,
    work: orderWork({ order, roles: me.roles, now }),
  }));
  const workByOrder = new Map(orders.map((entry) => [entry.order.id, entry.work]));
  const byQuote = ordersByQuote(orderList.items);

  const quotes = quoteList.items.map((quote) => ({
    quote,
    work: quoteWork({
      quote,
      orders: (byQuote.get(quote.id) ?? []).flatMap((order) => {
        const work = workByOrder.get(order.id);
        return work === undefined ? [] : [{ id: order.id, work }];
      }),
      roles: me.roles,
      now,
    }),
  }));

  return {
    me,
    quotes,
    orders,
    approvals: approvals.items,
    creditHolds,
    customers,
    refused,
  };
}
