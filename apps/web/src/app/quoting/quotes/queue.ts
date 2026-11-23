// Groups the Quotes list by whose move it is: docs/product/requirements.md (R12).
// Each quote's group comes from apps/web/src/lib/work/quote-work.ts.
import { quoteReference, type OrderStatus, type Quote } from '@erp/types';
import type { ChipTone } from '@erp/ui';

import type { Work, WorkGroup } from '../../../lib/work/work';
import { QUOTE_STATUS_LABELS, quoteWithOrdersWords } from '../format';

export type QuoteShow = 'open' | 'converted' | 'closed' | 'everything';

export const SHOW_OPTIONS: readonly { readonly value: QuoteShow; readonly label: string }[] = [
  { value: 'open', label: 'Open quotes' },
  { value: 'converted', label: 'Quoted, with orders' },
  { value: 'closed', label: 'Closed (lost) and superseded' },
  { value: 'everything', label: 'Everything' },
];

export function parseShow(raw: string | undefined): QuoteShow {
  return SHOW_OPTIONS.find((option) => option.value === raw)?.value ?? 'open';
}

export interface QueueOrder {
  readonly id: string;
  readonly jobNumber?: string | undefined;
  readonly status: OrderStatus;

  readonly createdAt: string;
}

export interface QueueQuote {
  readonly quote: Pick<
    Quote,
    | 'id'
    | 'quoteNumber'
    | 'versionNumber'
    | 'rootQuoteId'
    | 'customerId'
    | 'status'
    | 'salesRep'
    | 'updatedAt'
  >;
  readonly work: Work;

  readonly order?: QueueOrder | undefined;

  readonly orderCount?: number | undefined;
}

export type QueueGroupId = Extract<WorkGroup, 'yours' | 'another-desk' | 'customer' | 'converted'>;

const GROUP_HEADINGS: Record<QueueGroupId, string> = {
  yours: 'Your move',
  'another-desk': 'Waiting on another desk',
  customer: 'Quoted, with the customer',
  converted: 'Quoted, with orders',
};

const TABLE_GROUPS: readonly QueueGroupId[] = ['yours', 'another-desk', 'customer', 'converted'];

export const GROUP_TONES: Record<QueueGroupId | 'closed', ChipTone> = {
  yours: 'now',
  'another-desk': 'pending',
  customer: 'pending',
  converted: 'pending',
  closed: 'neutral',
};

interface QueueGroup {
  readonly id: QueueGroupId;

  readonly heading: string;
  readonly rows: readonly QueueQuote[];
}

export interface QuoteQueue {
  readonly groups: readonly QueueGroup[];

  readonly closed: readonly QueueQuote[] | null;

  readonly foldOpen: boolean;
}

function oldestFirst(a: QueueQuote, b: QueueQuote): number {
  return a.work.ageFrom.localeCompare(b.work.ageFrom);
}

function newestOrderFirst(a: QueueQuote, b: QueueQuote): number {
  return (b.order?.createdAt ?? '').localeCompare(a.order?.createdAt ?? '');
}

export function quoteQueue(rows: readonly QueueQuote[], show: QuoteShow): QuoteQueue {
  const kept: readonly QueueGroupId[] =
    show === 'open' || show === 'everything'
      ? TABLE_GROUPS
      : show === 'converted'
        ? ['converted']
        : [];

  const groups: QueueGroup[] = [];
  for (const id of kept) {
    const all = rows
      .filter((row) => row.work.group === id)
      .sort(id === 'converted' ? newestOrderFirst : oldestFirst);
    if (all.length === 0) continue;
    groups.push({ id, heading: `${GROUP_HEADINGS[id]} (${String(all.length)})`, rows: all });
  }

  // The open groups list the longest-waiting first. The closed fold lists the most recent first.
  const closed =
    show === 'converted'
      ? null
      : rows.filter((row) => row.work.group === 'closed').sort((a, b) => -oldestFirst(a, b));
  return { groups, closed, foldOpen: show === 'closed' };
}

export function queueChipLabel(
  status: QueueQuote['quote']['status'],
  group: QueueGroupId,
  orderCount: number | undefined,
): string {
  return group === 'converted' && status === 'quoted' && orderCount !== undefined && orderCount > 0
    ? quoteWithOrdersWords('quoted', orderCount)
    : QUOTE_STATUS_LABELS[status];
}

export function successorOf<Q extends Pick<Quote, 'rootQuoteId' | 'versionNumber' | 'quoteNumber'>>(
  quote: Q,
  all: readonly Q[],
): Q | undefined {
  return all.find(
    (other) =>
      other.rootQuoteId === quote.rootQuoteId && other.versionNumber === quote.versionNumber + 1,
  );
}

export function whatHappened(
  quote: Pick<Quote, 'status'>,
  successor: Pick<Quote, 'quoteNumber' | 'versionNumber'> | undefined,
): string {
  if (quote.status === 'closed_lost') return 'Closed as lost';
  if (successor !== undefined) return `Revised into ${quoteReference(successor)}`;
  return 'Revised into a newer version';
}

export function closedSum(
  closed: readonly QueueQuote[],
  successorOfQuote: (row: QueueQuote) => Pick<Quote, 'versionNumber'> | undefined,
): string {
  return closed
    .map((row) => {
      const reference = quoteReference(row.quote);
      if (row.quote.status === 'closed_lost') return `${reference} closed as lost`;
      const next = successorOfQuote(row);
      return next === undefined
        ? `${reference} superseded`
        : `${reference} superseded by v${String(next.versionNumber)}`;
    })
    .join(' · ');
}

function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1) ?? ''}`;
}

export function noRepFootnote(
  quotes: readonly Pick<Quote, 'salesRep' | 'customerId'>[],
  customerName: (customerId: string) => string,
): string | null {
  const counts = new Map<string, number>();
  for (const quote of quotes) {
    if (quote.salesRep !== undefined) continue;
    counts.set(quote.customerId, (counts.get(quote.customerId) ?? 0) + 1);
  }
  if (counts.size === 0) return null;
  const total = [...counts.values()].reduce((sum, n) => sum + n, 0);
  const named = [...counts.entries()]
    .map(([id, n]) => ({ name: customerName(id), n }))
    .sort((a, b) => b.n - a.n || a.name.localeCompare(b.name))
    .map(({ name, n }) => `${name} (${String(n)})`);
  const lead =
    total === 1
      ? '1 quote has no rep and shows under All reps'
      : `${String(total)} quotes have no rep and show under All reps`;
  return `${lead}: ${joinNames(named)}.`;
}
