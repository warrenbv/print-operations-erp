// The API reads the quote pages make. Each one fetches and parses one route.
import {
  customerSchema,
  orderListResponseSchema,
  pricingConfigSchema,
  quoteOverrideDecisionListResponseSchema,
  quoteSendAttemptListResponseSchema,
  quoteSendabilitySchema,
  quoteTotalsSchema,
  quoteVersionsResponseSchema,
  quoteWithLinesSchema,
  type Customer,
  type Order,
  type OrderLine,
  type PricingConfig,
  type Quote,
  type QuoteOverrideDecision,
  type QuoteSendAttempt,
  type QuoteSendability,
  type QuoteTotals,
  type QuoteWithLines,
} from '@erp/types';

import { fetchParsed } from '../../../../lib/fetch-parsed';
import { loadOrderLines } from './convert/loaders';
import { couldHaveOrder } from './derive';

export { loadGrades } from '../../load-grades';
export { loadTiers } from '../../load-tiers';

export async function loadQuote(id: string): Promise<QuoteWithLines | null> {
  return fetchParsed(`/quoting/quotes/${encodeURIComponent(id)}`, quoteWithLinesSchema, {
    notFound: 'null',
  });
}

export async function loadSendability(id: string): Promise<QuoteSendability> {
  return fetchParsed(
    `/quoting/quotes/${encodeURIComponent(id)}/sendability`,
    quoteSendabilitySchema,
  );
}

export async function loadSends(id: string): Promise<QuoteSendAttempt[]> {
  const { items } = await fetchParsed(
    `/quoting/quotes/${encodeURIComponent(id)}/sends`,
    quoteSendAttemptListResponseSchema,
  );

  return [...items];
}

export async function loadTotals(id: string): Promise<QuoteTotals> {
  return fetchParsed(`/quoting/quotes/${encodeURIComponent(id)}/totals`, quoteTotalsSchema);
}

export async function loadVersions(id: string): Promise<Quote[]> {
  const { items } = await fetchParsed(
    `/quoting/quotes/${encodeURIComponent(id)}/versions`,

    quoteVersionsResponseSchema,
  );
  return [...items].sort((a, b) => a.versionNumber - b.versionNumber);
}

export async function loadDecisions(id: string): Promise<QuoteOverrideDecision[]> {
  const { items } = await fetchParsed(
    `/quoting/quotes/${encodeURIComponent(id)}/override/decisions`,
    quoteOverrideDecisionListResponseSchema,
  );
  return [...items];
}

export async function loadPricingConfig(): Promise<PricingConfig> {
  return fetchParsed('/quoting/config', pricingConfigSchema);
}

export async function loadOrdersForQuote(quote: QuoteWithLines): Promise<readonly Order[]> {
  // Only a quoted or superseded quote can have orders, so other statuses skip the request.
  if (!couldHaveOrder(quote.status)) {
    return [];
  }
  const { items } = await fetchParsed(
    `/orders?quoteId=${encodeURIComponent(quote.id)}`,
    orderListResponseSchema,
  );

  return items;
}

export async function loadOrderDetails(orders: readonly Order[]): Promise<{
  lines: ReadonlyMap<string, readonly OrderLine[]>;
}> {
  if (orders.length === 0) return { lines: new Map() };
  return { lines: await loadOrderLines(orders.map((order) => order.id)) };
}

export async function loadCustomer(id: string): Promise<Customer | null> {
  return fetchParsed(`/crm/customers/${encodeURIComponent(id)}`, customerSchema, {
    notFound: 'null',
  });
}
