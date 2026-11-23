// The record view of a quote past draft: its step strip, chip, Act now panel and orders table.
// Every quote page names the next act or the desk it waits on: docs/product/requirements.md (R12).
// The lifecycle behind the strip is apps/web/src/lib/record/lifecycle.ts.
import type { ChipTone } from '@erp/ui';
import {
  type ErpRole,
  type Order,
  type OrderLine,
  type QuoteSendAttempt,
  type QuoteStatus,
  type QuoteWithLines,
} from '@erp/types';

import { formatDay } from '../../../../lib/dates';
import { formatOrderedPounds } from '../../../../lib/measures';
import { lifecycle, type RecordAct, type RecordStep } from '../../../../lib/record/lifecycle';
import { queueName } from '../../../../lib/record-title';
import type { QuoteWorkItem } from '../../../../lib/work/quote-work';
import { orderFoldPage, orderPage } from '../../../../lib/work/work';
import { byDeliveryDate, ORDER_STATUS_LABELS } from '../../../orders/format';
import { QUOTE_STATUS_LABELS, quoteWithOrdersWords } from '../../format';
import { manualPriceCount } from './derive';

export function quoteWorkItem(quote: QuoteWithLines): QuoteWorkItem {
  const lines = [...quote.lines].sort((a, b) => a.lineNumber - b.lineNumber);
  const manual = lines.find((line) => line.priceSource === 'manual');
  return {
    id: quote.id,
    status: quote.status,
    leadTimeDays: quote.leadTimeDays,
    overrideApprovedAt: quote.overrideApprovedAt,
    floorOverrideAt: quote.floorOverrideAt,
    updatedAt: quote.updatedAt,
    lineCount: lines.length,
    belowFloorCount: lines.filter((line) => line.floor.status === 'below_floor').length,
    manualCount: manualPriceCount(lines),
    manualPricePerRoll: manual?.pricePerRoll ?? null,
  };
}

/**
 * When the quote first reached the customer: the earliest accepted customer copy, not counting
 * internal alerts or the lead-time request. The send log reads newest first
 * (modules/notifications/src/ports.ts), so the earliest is the last entry.
 */
export function customerSentAt(sends: readonly QuoteSendAttempt[]): string | null {
  const accepted = sends.filter(
    (send) =>
      send.audience === 'customer' && send.outcome === 'accepted' && send.kind === undefined,
  );
  return accepted.at(-1)?.submittedAt ?? null;
}

/** When Production was last asked for a lead time, accepted or not. The log reads newest first. */
export function productionToldAt(sends: readonly QuoteSendAttempt[]): string | null {
  return sends.find((send) => send.kind === 'lead-time-request')?.submittedAt ?? null;
}

export function quoteStrip({
  quote,
  roles,
  now,
}: {
  quote: QuoteWithLines;
  roles: readonly ErpRole[];
  now: Date;
}): readonly RecordStep[] {
  return lifecycle({
    kind: 'quote',
    record: quoteWorkItem(quote),
    orders: [],
    sentAt: null,
    productionToldAt: null,
    roles,
    now,
  }).steps;
}

export function quoteChip(
  status: QuoteStatus,
  orderCount: number,
): { readonly label: string; readonly tone: ChipTone } {
  if (status === 'quoted') {
    const label =
      orderCount > 0 ? quoteWithOrdersWords('quoted', orderCount) : QUOTE_STATUS_LABELS.quoted;
    return { label, tone: 'pending' };
  }
  if (status === 'superseded' && orderCount > 0) {
    return { label: quoteWithOrdersWords('superseded', orderCount), tone: 'neutral' };
  }
  return { label: QUOTE_STATUS_LABELS[status], tone: 'neutral' };
}

type QuotePanelVariant = 'convert' | 'waiting' | 'orders' | 'superseded' | 'closed';

export interface QuotePanel {
  readonly variant: QuotePanelVariant;
  readonly tone: RecordAct['tone'];
  readonly title: string;
  readonly who: string;
}

export interface QuotePanelInput {
  readonly status: QuoteStatus;

  readonly orders: readonly Pick<Order, 'createdAt'>[];

  readonly canWrite: boolean;

  readonly act: RecordAct;
}

export function quotePanel(input: QuotePanelInput): QuotePanel {
  const { status, orders, canWrite, act } = input;
  // Once orders exist the panel speaks of them, whatever else the lifecycle would say.
  const newest = orders[0];
  if (newest !== undefined && (status === 'quoted' || status === 'superseded')) {
    return {
      variant: 'orders',
      tone: status === 'quoted' ? 'act' : 'done',
      title: quoteWithOrdersWords(status, orders.length),
      who: `Last order ${formatDay(newest.createdAt)}`,
    };
  }
  switch (status) {
    case 'quoted':
      return canWrite
        ? {
            variant: 'convert',
            tone: 'act',
            title: 'Convert to order',
            who: `When the customer says yes · ${act.who}`,
          }
        : { variant: 'waiting', tone: 'waiting', title: 'Waiting on the customer', who: act.who };
    case 'superseded':
      return { variant: 'superseded', tone: act.tone, title: act.title, who: act.who };
    case 'closed_lost':
      return { variant: 'closed', tone: act.tone, title: act.title, who: act.who };
    case 'draft':
    case 'override_requested':
      return { variant: 'waiting', tone: act.tone, title: act.title, who: act.who };
  }
}

export interface QuoteOrderRow {
  readonly id: string;

  readonly href: string;

  readonly name: string;

  readonly poNumber: string;

  readonly deliveryDate: string;

  readonly lines: readonly string[];

  readonly status: string;
}

export type QuoteOrderLine = Pick<
  OrderLine,
  'lineNumber' | 'quantityRolls' | 'pricingBasis' | 'orderedWeightLb'
>;

export function orderLineWords(line: QuoteOrderLine): string {
  const rolls = `${String(line.quantityRolls)} roll${line.quantityRolls === 1 ? '' : 's'}`;
  const pounds =
    line.pricingBasis === 'per_pound' && line.orderedWeightLb !== undefined
      ? `, ${formatOrderedPounds(line.orderedWeightLb)} lb`
      : '';
  return `Line ${String(line.lineNumber)}: ${rolls}${pounds}`;
}

export function quoteOrderRows(input: {
  readonly orders: readonly Order[];

  readonly quoteRef: string;
  readonly lines: ReadonlyMap<string, readonly QuoteOrderLine[]>;
}): QuoteOrderRow[] {
  return [...input.orders].sort(byDeliveryDate).map((order) => ({
    id: order.id,
    href: orderPage(order.id),
    name: queueName(order, input.quoteRef),
    poNumber: order.poNumber ?? 'None',
    deliveryDate: order.requestedDate ?? 'None given',
    lines: [...(input.lines.get(order.id) ?? [])]
      .sort((a, b) => a.lineNumber - b.lineNumber)
      .map(orderLineWords),
    status: ORDER_STATUS_LABELS[order.status],
  }));
}

export interface MissingDocumentRow {
  readonly id: string;

  readonly href: string;

  readonly name: string;
}

/**
 * The orders whose PO document failed to attach, named by the `poMissing` query parameter that
 * apps/web/src/app/quoting/quotes/[id]/convert/convert-po-document.ts writes. Unknown ids are ignored.
 */
export function missingDocumentRows(
  raw: string | string[] | undefined,
  orders: readonly Order[],
  quoteRef: string,
): MissingDocumentRow[] {
  if (typeof raw !== 'string' || raw === '') return [];
  const ids = new Set(raw.split(','));
  return orders
    .filter((order) => ids.has(order.id))
    .sort(byDeliveryDate)
    .map((order) => ({
      id: order.id,
      href: orderFoldPage(order.id, 'documents'),
      name: `${queueName(order, quoteRef)}, delivery ${order.requestedDate ?? 'none given'}`,
    }));
}
