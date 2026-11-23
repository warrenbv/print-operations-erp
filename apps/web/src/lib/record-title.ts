// Tab titles for record pages, read from the API with the page's own path.
// A missing record is titled as the not-found page is. Any other failure, a signed-out reader included, gets the page's generic title.
// Records are named in words rather than internal ids: docs/product/ux-direction.md.
import { shortId } from '@erp/types';

import { apiFetch } from './api-fetch';
import { loadSessionOutcome } from './load-me';
import { notFoundNotice } from './not-found-notice';

interface ParseSchema<T> {
  parse(input: unknown): T;
}

export type RecordRead<T> =
  | { readonly kind: 'found'; readonly record: T }
  | { readonly kind: 'missing' }
  | { readonly kind: 'unread' };

export const MISSING_RECORD_TITLE = notFoundNotice().heading;

/**
 * Reads a record for a page's title. Never throws or redirects. A signed-out reader gets `unread`
 * without the record being read.
 */
export async function recordRead<T>(path: string, schema: ParseSchema<T>): Promise<RecordRead<T>> {
  try {
    const outcome = await loadSessionOutcome();
    if (outcome.kind !== 'signed-in') return { kind: 'unread' };
    const response = await apiFetch(path);
    if (response.status === 404) return { kind: 'missing' };
    if (!response.ok) return { kind: 'unread' };
    return { kind: 'found', record: schema.parse(await response.json()) };
  } catch {
    return { kind: 'unread' };
  }
}

export async function recordTitle<T>(
  path: string,
  schema: ParseSchema<T>,
  nameOf: (record: T) => string,
  fallback: string,
  { whenMissing = MISSING_RECORD_TITLE }: { readonly whenMissing?: string } = {},
): Promise<string> {
  const read = await recordRead(path, schema);
  switch (read.kind) {
    case 'found':
      return nameOf(read.record);
    case 'missing':
      return whenMissing;
    case 'unread':
      return fallback;
  }
}

// An order's name in lists: its job number once it has one, otherwise the quote it came from, otherwise the tail of its id.
export function queueName(
  order: { readonly id: string; readonly jobNumber?: string | undefined },
  quoteRef: string | null | undefined,
): string {
  if (order.jobNumber !== undefined) return order.jobNumber;
  if (quoteRef !== null && quoteRef !== undefined) return `Order from ${quoteRef}`;
  return `Order ${shortId(order.id)}`;
}
