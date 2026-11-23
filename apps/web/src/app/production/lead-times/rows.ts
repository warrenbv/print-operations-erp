// Builds the lead-time queue from one API read per quote status, merged and oldest first, and words its rows.
import type { QuoteListItem, QuoteStatus } from '@erp/types';

// A quote waiting on a price approval may still lack its lead time, so it stays in this queue.
const LEAD_TIME_QUEUE_STATUSES: readonly QuoteStatus[] = ['draft', 'override_requested'];

export function leadTimeQueueQueries(): string[] {
  return LEAD_TIME_QUEUE_STATUSES.map((status) =>
    new URLSearchParams({ status, leadTime: 'missing' }).toString(),
  );
}

export function leadTimeQueue(reads: readonly (readonly QuoteListItem[])[]): QuoteListItem[] {
  const byId = new Map<string, QuoteListItem>();
  for (const quote of reads.flat()) byId.set(quote.id, quote);
  return [...byId.values()].sort(
    (a, b) => a.updatedAt.localeCompare(b.updatedAt) || a.id.localeCompare(b.id),
  );
}

export function linesLabel(lineCount: number): string {
  return lineCount === 0 ? 'no lines yet' : `${String(lineCount)} priced`;
}

export function toldLabel(
  productionToldAt: string | null | undefined,
  formatDay: (iso: string) => string,
): string {
  return productionToldAt === null || productionToldAt === undefined
    ? ''
    : formatDay(productionToldAt);
}

export function leadTimeHref(quoteId: string): string {
  return `/quoting/quotes/${encodeURIComponent(quoteId)}#lead-time`;
}
