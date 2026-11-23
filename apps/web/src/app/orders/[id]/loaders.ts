// The API reads behind the order page, one function per read. A missing order or quote reads as null.
import {
  customerSchema,
  orderDocumentListResponseSchema,
  orderListResponseSchema,
  orderTotalsSchema,
  orderTransitionListResponseSchema,
  orderWithLinesSchema,
  quoteReference,
  quoteSendAttemptListResponseSchema,
  quoteWithLinesSchema,
  type Customer,
  type Order,
  type OrderTotals,
  type OrderTransition,
  type OrderWithLines,
  type QuoteSendAttempt,
  type StoredDocumentSummary,
} from '@erp/types';

import { fetchParsed } from '../../../lib/fetch-parsed';

export { loadGrades } from '../../quoting/load-grades';

export async function loadOrder(id: string): Promise<OrderWithLines | null> {
  return fetchParsed(`/orders/${encodeURIComponent(id)}`, orderWithLinesSchema, {
    notFound: 'null',
  });
}

export async function loadTotals(id: string): Promise<OrderTotals> {
  return fetchParsed(`/orders/${encodeURIComponent(id)}/totals`, orderTotalsSchema);
}

export async function loadTransitions(id: string): Promise<OrderTransition[]> {
  const { items } = await fetchParsed(
    `/orders/${encodeURIComponent(id)}/transitions`,
    orderTransitionListResponseSchema,
  );
  return [...items];
}

export async function loadDocuments(id: string): Promise<StoredDocumentSummary[]> {
  const { documents } = await fetchParsed(
    `/orders/${encodeURIComponent(id)}/documents`,
    orderDocumentListResponseSchema,
  );
  return [...documents];
}

export async function loadQuoteFacts(quoteId: string): Promise<{
  reference: string;
  leadTimeDays: number | undefined;
} | null> {
  const quote = await fetchParsed(
    `/quoting/quotes/${encodeURIComponent(quoteId)}`,
    quoteWithLinesSchema,
    { notFound: 'null' },
  );
  return quote === null
    ? null
    : {
        reference: quoteReference(quote),
        leadTimeDays: quote.leadTimeDays,
      };
}

export async function loadOrdersOfQuote(quoteId: string): Promise<readonly Order[]> {
  const { items } = await fetchParsed(
    `/orders?quoteId=${encodeURIComponent(quoteId)}`,
    orderListResponseSchema,
  );
  return items;
}

export async function loadCustomer(id: string): Promise<Customer | null> {
  return fetchParsed(`/crm/customers/${encodeURIComponent(id)}`, customerSchema, {
    notFound: 'null',
  });
}

export async function loadOrderSends(id: string): Promise<readonly QuoteSendAttempt[]> {
  const { items } = await fetchParsed(
    `/orders/${encodeURIComponent(id)}/sends`,
    quoteSendAttemptListResponseSchema,
  );
  return items;
}
