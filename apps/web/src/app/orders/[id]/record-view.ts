// Pure helpers that word the order page: the heading, the lede, the pre-filled confirmation, the summaries
// of the folded sections and the last confirmation email.
import {
  addCalendarDays,
  businessDayOf,
  calendarDaysBetween,
  formatMoney,
  gradeLabel,
  palletsText,
  toDecimal,
  type Grade,
  type Order,
  type OrderLine,
  type OrderStatus,
  type OrderTotals,
  type OrderTransition,
  type QuoteSendAttempt,
  type StoredDocumentSummary,
} from '@erp/types';
import type { ChipTone } from '@erp/ui';

import { recipientListLabel } from '../../../lib/confirm-recipients';
import { formatDay } from '../../../lib/dates';
import { formatFeet, formatWidth } from '../../../lib/measures';
import type { RecordAct } from '../../../lib/record/lifecycle';
import { dueDay } from './due-day';
import { deliveryWords } from '../../quoting/quotes/[id]/line-defaults';
import { byDeliveryDate, DOCUMENT_KIND_LABELS, ORDER_STATUS_LABELS, orderName } from '../format';

export function orderHeading({
  order,
  quoteRef,
  customerName,
}: {
  order: Pick<Order, 'id' | 'jobNumber'>;
  quoteRef: string | null;
  customerName: string;
}): { crumbLabel: string; title: string } {
  const crumbLabel = order.jobNumber ?? orderName(order, quoteRef);
  return { crumbLabel, title: `${crumbLabel} for ${customerName}` };
}

export function chipTone(act: Pick<RecordAct, 'tone'>): ChipTone {
  if (act.tone === 'act') return 'now';
  return act.tone === 'waiting' ? 'pending' : 'done';
}

function rolls(count: number): string {
  return `${String(count)} roll${count === 1 ? '' : 's'}`;
}

function paperOf(line: Pick<OrderLine, 'gradeId'>, gradeById: ReadonlyMap<string, Grade>): string {
  const grade = gradeById.get(line.gradeId);
  return grade === undefined ? line.gradeId : gradeLabel(grade);
}

function size(line: OrderLine): string {
  return line.feetPerRoll === undefined
    ? formatWidth(line)
    : `${formatWidth(line)} × ${formatFeet(line.feetPerRoll)} ft`;
}

function dueWords(due: string, now: Date): string {
  const days = calendarDaysBetween(businessDayOf(now), due);
  if (days > 1) return `Due ${due}, in ${String(days)} days.`;
  if (days === 1) return `Due ${due}, tomorrow.`;
  if (days === 0) return `Due today, ${due}.`;
  const ago = -days;
  return `Due ${due}, ${String(ago)} day${ago === 1 ? '' : 's'} ago.`;
}

export function orderLede({
  order,
  lines,
  gradeById,
  mayConfirm,
  now,
}: {
  order: Pick<Order, 'status' | 'confirmedAt' | 'confirmedLeadTimeDays'>;
  lines: readonly OrderLine[];
  gradeById: ReadonlyMap<string, Grade>;
  mayConfirm: boolean;
  now: Date;
}): string {
  const [only] = lines;
  const words =
    lines.length === 1 && only !== undefined
      ? `${paperOf(only, gradeById)}, ${size(only)}, ${rolls(only.quantityRolls)}, ${deliveryWords(
          only.freight.mode,
          only.deliveryAddress,
        )}.`
      : `${String(lines.length)} lines, ${rolls(lines.reduce((sum, line) => sum + line.quantityRolls, 0))}.`;

  let tail: string | undefined;
  if (order.status === 'converted') {
    tail = mayConfirm
      ? 'The job number is given when you confirm.'
      : 'The job number is given on confirmation.';
  } else {
    const due = dueDay(order);
    if (due !== undefined) tail = dueWords(due, now);
  }
  return tail === undefined ? words : `${words} ${tail}`;
}

/**
 * The committed lead time is pre-filled from the quoted one and counts calendar days:
 * docs/product/requirements.md (R11).
 */
export function confirmDefault(
  quoteLeadTimeDays: number | undefined,
  now: Date,
): { value?: number; hint: string } {
  if (quoteLeadTimeDays === undefined) {
    return { hint: 'Calendar days from today, weekends included. 0 means same day.' };
  }
  const due = addCalendarDays(businessDayOf(now), quoteLeadTimeDays);
  return {
    value: quoteLeadTimeDays,
    hint: `Pre-filled from the quote. Calendar days from today, weekends included. Due ${due}.`,
  };
}

export function waitingWords(status: OrderStatus): string | undefined {
  if (status === 'converted') {
    return 'The order is confirmed by the Production Manager. You will see it move here.';
  }
  return undefined;
}

function wholePounds(value: string): string {
  return Math.round(Number(value)).toLocaleString('en-US');
}

export function lineNote(line: OrderLine): string {
  const pallets = line.pallets === null ? 'Pallets not counted' : palletsText(line.pallets);
  const kind = line.printed ? 'Printed.' : 'Plain, not printed.';
  return `${kind} ${pallets}, about ${wholePounds(line.estimatedWeightLb)} lb.`;
}

export function totalsSum(
  totals: Pick<
    OrderTotals,
    'extendedPrice' | 'extendedMargin' | 'freightInvoiceTotal' | 'freightPending'
  >,
): string {
  let freight: string;
  if (totals.freightPending) freight = 'freight not final';
  else if (!toDecimal(totals.freightInvoiceTotal).gt(0)) freight = 'no freight';
  else freight = `freight ${formatMoney(totals.freightInvoiceTotal)}`;
  return `${formatMoney(totals.extendedPrice)} · margin ${formatMoney(totals.extendedMargin)} · ${freight}`;
}

export function otherOrders<O extends Pick<Order, 'id' | 'requestedDate' | 'createdAt'>>(
  ordersOfQuote: readonly O[],
  orderId: string,
): O[] {
  return ordersOfQuote.filter((order) => order.id !== orderId).sort(byDeliveryDate);
}

export function otherOrderWords(
  order: Pick<Order, 'poNumber' | 'requestedDate' | 'status'>,
): string {
  const po = order.poNumber === undefined ? 'no PO number' : `PO ${order.poNumber}`;
  const date =
    order.requestedDate === undefined ? 'no delivery date' : `delivery ${order.requestedDate}`;
  return `${po}, ${date}, ${ORDER_STATUS_LABELS[order.status]}`;
}

function lowerFirst(words: string): string {
  return words.charAt(0).toLowerCase() + words.slice(1);
}

export function documentsSum(documents: readonly StoredDocumentSummary[]): string {
  const newest = documents.reduce<StoredDocumentSummary | undefined>(
    (latest, document) =>
      latest === undefined || document.documentAt > latest.documentAt ? document : latest,
    undefined,
  );
  if (newest === undefined) return 'nothing filed yet';
  const kind = lowerFirst(DOCUMENT_KIND_LABELS[newest.kind] ?? newest.kind);
  const by =
    newest.uploadedBy === null || newest.uploadedBy === undefined
      ? ''
      : `, recorded by ${newest.uploadedBy}`;
  return `${kind}${by} ${formatDay(newest.documentAt)}`;
}

export function historySum(transitions: readonly OrderTransition[]): string {
  const items = transitions.map(
    (transition) => `${lowerFirst(ORDER_STATUS_LABELS[transition.to])} ${formatDay(transition.at)}`,
  );
  return items.join(' · ');
}

export function ocLine(sends: readonly QuoteSendAttempt[]): { to: string; on: string } | null {
  const newest = newestConfirmationSend(sends);
  return newest === undefined
    ? null
    : { to: recipientListLabel(newest.recipients), on: formatDay(newest.submittedAt) };
}

function newestConfirmationSend(sends: readonly QuoteSendAttempt[]): QuoteSendAttempt | undefined {
  return sends
    .filter(
      (send) =>
        send.audience === 'customer' && send.outcome === 'accepted' && send.kind === undefined,
    )
    .reduce<QuoteSendAttempt | undefined>(
      (latest, send) =>
        latest === undefined || send.submittedAt > latest.submittedAt ? send : latest,
      undefined,
    );
}
