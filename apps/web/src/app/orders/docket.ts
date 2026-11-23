// Filters, sorts and words the rows of the Orders list. An order missing the sort field goes last,
// and ties fall back to creation order.
import { ORDER_STATUSES, type Order, type OrderStatus } from '@erp/types';
import type { ChipTone } from '@erp/ui';

import { formatAge, isLate } from '../../lib/dates';
import { queueName } from '../../lib/record-title';
import type { Work, WorkWith } from '../../lib/work/work';
import { ORDER_STATUS_LABELS } from './format';

export const DOCKET_SORTS = ['requested', 'job', 'customer', 'status'] as const;

export type DocketSort = (typeof DOCKET_SORTS)[number];

export function isDocketSort(value: string): value is DocketSort {
  return (DOCKET_SORTS as readonly string[]).includes(value);
}

export type DocketFilter = { kind: 'all' } | { kind: 'status'; status: OrderStatus };

export function parseFilter(raw: string | undefined): DocketFilter {
  return raw !== undefined && (ORDER_STATUSES as readonly string[]).includes(raw)
    ? { kind: 'status', status: raw as OrderStatus }
    : { kind: 'all' };
}

export function filterValue(filter: DocketFilter): string {
  return filter.kind === 'status' ? filter.status : 'all';
}

export function buildOrderQuery(filter: DocketFilter, rep?: string): string {
  const params = new URLSearchParams();
  if (filter.kind === 'status') {
    params.append('status', filter.status);
  }

  if (rep !== undefined) {
    params.set('salesRep', rep);
  }
  return params.toString();
}

const STATUS_ORDER = new Map(ORDER_STATUSES.map((s, i) => [s, i] as const));

export function sortDocket(
  orders: readonly Order[],
  sort: DocketSort,
  customerNames: ReadonlyMap<string, string>,
): Order[] {
  const byCreated = (a: Order, b: Order): number => a.createdAt.localeCompare(b.createdAt);

  const missingLast = (a: string | undefined, b: string | undefined): number | undefined => {
    if (a === undefined && b === undefined) return 0;
    if (a === undefined) return 1;
    if (b === undefined) return -1;
    return undefined;
  };

  return [...orders].sort((a, b) => {
    switch (sort) {
      case 'requested': {
        const gap = missingLast(a.requestedDate, b.requestedDate);
        if (gap !== undefined && gap !== 0) return gap;
        const cmp = (a.requestedDate ?? '').localeCompare(b.requestedDate ?? '');
        return cmp !== 0 ? cmp : byCreated(a, b);
      }
      case 'job': {
        const gap = missingLast(a.jobNumber, b.jobNumber);
        if (gap !== undefined && gap !== 0) return gap;
        const cmp = (a.jobNumber ?? '').localeCompare(b.jobNumber ?? '');
        return cmp !== 0 ? cmp : byCreated(a, b);
      }
      case 'customer': {
        const cmp = (customerNames.get(a.customerId) ?? a.customerId).localeCompare(
          customerNames.get(b.customerId) ?? b.customerId,
        );
        return cmp !== 0 ? cmp : byCreated(a, b);
      }
      case 'status': {
        const cmp = (STATUS_ORDER.get(a.status) ?? 0) - (STATUS_ORDER.get(b.status) ?? 0);
        return cmp !== 0 ? cmp : byCreated(a, b);
      }
    }
  });
}

export interface DocketRow {
  readonly id: string;
  readonly name: string;
  readonly href: string;
  readonly customer: string;
  readonly status: string;
  readonly tone: ChipTone;

  readonly next: string | null;
  readonly with: WorkWith | null;
  readonly waiting: string;

  readonly late: boolean;
}

export function chipTone(work: Work | undefined): ChipTone {
  if (work === undefined) return 'pending';
  switch (work.group) {
    case 'yours':
      return 'now';
    case 'done':
      return 'done';
    default:
      return 'pending';
  }
}

export interface DocketRowsInput {
  readonly work: ReadonlyMap<string, Work>;
  readonly customerNames: ReadonlyMap<string, string>;
  readonly quoteRefs: ReadonlyMap<string, string>;
  readonly now: Date;
}

export function docketRows(orders: readonly Order[], input: DocketRowsInput): DocketRow[] {
  return orders.map((order) => {
    const work = input.work.get(order.id);
    const ageFrom = work?.ageFrom ?? order.updatedAt;
    return {
      id: order.id,
      name: queueName(order, input.quoteRefs.get(order.quoteId)),
      href: `/orders/${encodeURIComponent(order.id)}`,
      customer: input.customerNames.get(order.customerId) ?? order.customerId,
      status: ORDER_STATUS_LABELS[order.status],
      tone: chipTone(work),
      next: work?.next ?? null,
      with: work?.with ?? null,
      waiting: formatAge(ageFrom, input.now),
      late: isLate(ageFrom, input.now),
    };
  });
}
