// The work row for a quote: its next act, whose desk it is with, and where the act is done.
// Like apps/web/src/lib/work/order-work.ts, it asks the Next line once with every gate held and once with the reader's desk roles.
// A sent quote is with the customer. A quote with orders takes its row from its newest order.
import { formatMoney, type ErpRole, type Quote, type QuoteListItem } from '@erp/types';

import { sendAction } from '../../app/quoting/quotes/[id]/action-rail';
import type { NextStepLine } from '../order-next-step';
import { quoteNextStep } from './quote-next-step';
import {
  ALL_GATES,
  absolute,
  deskRoles,
  quotePage,
  settled,
  type Work,
  type WorkDesk,
} from './work';

type QuoteLineSummary = Pick<
  QuoteListItem,
  'lineCount' | 'belowFloorCount' | 'manualCount' | 'manualPricePerRoll'
>;

export type QuoteWorkItem = Pick<
  Quote,
  'id' | 'status' | 'leadTimeDays' | 'overrideApprovedAt' | 'floorOverrideAt' | 'updatedAt'
> &
  QuoteLineSummary;

// True while a line is below the floor and no Admin override is recorded: docs/product/requirements.md (R6).
export function floorOwed(
  quote: Pick<QuoteWorkItem, 'belowFloorCount' | 'floorOverrideAt'>,
): boolean {
  return quote.belowFloorCount > 0 && quote.floorOverrideAt === undefined;
}

export interface QuoteWorkInput {
  readonly quote: QuoteWorkItem;

  readonly orders: readonly { readonly id: string; readonly work: Work }[];
  readonly roles: readonly ErpRole[];

  readonly now: Date;
}

export function approvePriceWords(manualCount: number, manualPricePerRoll: string | null): string {
  if (manualCount > 1) return `Approve ${String(manualCount)} hand-set prices`;
  if (manualPricePerRoll === null) return 'Approve the hand-set price';
  return `Approve the hand-set price of ${formatMoney(manualPricePerRoll)} per roll`;
}

function quoteRow(label: string, quote: QuoteWorkItem): { next: string; with: WorkDesk } {
  switch (label) {
    case 'Add a line':
      return { next: 'Add the first line', with: 'Sales' };
    case 'Go to the request':
      return {
        next: floorOwed(quote) ? 'Request approval' : 'Request price approval',
        with: 'Sales',
      };
    case 'Open Approvals':
      return floorOwed(quote)
        ? { next: 'Decide the line below the floor', with: 'An Admin' }
        : {
            next: approvePriceWords(quote.manualCount, quote.manualPricePerRoll),
            with: 'The Billing Manager',
          };
    case 'Go to the lead time':
      return { next: 'Enter the lead time', with: 'Production' };
    case 'Go to Send quote':
      return { next: 'Send the quote', with: 'Sales' };
    // Throws on an unknown label, so a new Next line cannot reach the queues without a row.
    default:
      throw new Error(`no work row for the quote Next line "${label}"`);
  }
}

export function quoteNextLine(
  quote: QuoteWorkItem,
  orderIds: readonly string[],
  roles: readonly ErpRole[],
): NextStepLine | null {
  return quoteNextStep({
    quoteId: quote.id,
    status: quote.status,
    lineCount: quote.lineCount,
    leadTimeDays: quote.leadTimeDays,
    // A list item carries counts, not lines, so the floor verdict is rebuilt from `belowFloorCount`.
    // `floorOverrider` stays false because apps/web/src/lib/work/quote-next-step.ts treats both floor kinds alike.
    send: sendAction({
      status: quote.status,

      sendability: floorOwed(quote) ? { sendable: false, belowFloor: [] } : { sendable: true },
      manualCount: quote.manualCount,
      approvalLive: quote.overrideApprovedAt !== undefined,

      floorOverrider: false,
    }),
    orderIds,
    roles,
  });
}

export function quoteWork(input: QuoteWorkInput): Work {
  const { quote, orders, roles } = input;
  const page = quotePage(quote.id);
  const orderIds = orders.map((order) => order.id);
  const ask = (gates: readonly ErpRole[]) => quoteNextLine(quote, orderIds, gates);

  const full = ask(ALL_GATES);
  if (full?.action === undefined) return settled('closed', quote.updatedAt, page);
  const { label, href } = full.action;

  if (label === 'Convert this quote') {
    return {
      group: 'customer',
      next: 'Convert to an order when the customer says yes',
      with: 'Customer',
      desk: null,
      ageFrom: quote.updatedAt,
      href,
    };
  }
  const newest = orders.at(-1);
  if (label === 'Create another order' && newest !== undefined) {
    return { ...newest.work, group: 'converted' };
  }

  const row = quoteRow(label, quote);
  const own = ask(deskRoles(roles));
  if (own?.action !== undefined) {
    return {
      group: 'yours',
      next: row.next,
      with: 'You',
      desk: row.with,
      ageFrom: quote.updatedAt,
      href: absolute(own.action.href, page),
    };
  }
  return {
    group: 'another-desk',
    next: row.next,
    with: row.with,
    desk: row.with,
    ageFrom: quote.updatedAt,
    href: page,
  };
}
