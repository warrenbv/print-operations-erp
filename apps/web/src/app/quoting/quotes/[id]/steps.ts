// The four quote steps (customer, lines, delivery and tax, review and send) and the summary under each.
// The stepped entry comes from docs/product/ux-direction.md. Drawn by apps/web/src/app/quoting/quotes/[id]/components/steps-header.tsx.
import type { QuoteLine, ShippingMode } from '@erp/types';

import { TAX_STATUS_LABELS } from '../../../../lib/line-labels';

type StepState = 'done' | 'current' | 'todo';

type QuoteStepNumber = 1 | 2 | 3 | 4;

export interface QuoteStep {
  readonly number: QuoteStepNumber;
  readonly label: string;

  readonly state: StepState;

  readonly done: boolean;

  readonly href?: string;
  readonly summary: string;
}

export interface QuoteStepsInput {
  readonly quoteId: string;
  readonly customerName: string;

  readonly lines: readonly Pick<QuoteLine, 'freight' | 'taxStatus' | 'deliveryAddress'>[];

  readonly openRows: number;
  readonly leadTimeDays: number | undefined;

  readonly current?: QuoteStepNumber;
}

export function stepHrefs(quoteId: string) {
  return {
    customer: `/quoting/quotes/${quoteId}/customer`,
    lines: `/quoting/quotes/${quoteId}`,
    delivery: `/quoting/quotes/${quoteId}/delivery`,
    review: `/quoting/quotes/${quoteId}/review`,

    close: `/quoting/quotes/${quoteId}/close`,

    buildUp: `/quoting/quotes/${quoteId}/build-up`,
  } as const;
}

export function buildUpHref(quoteId: string, lineNumber: number): string {
  return `/quoting/quotes/${quoteId}/build-up#line-${String(lineNumber)}`;
}

export function quoteSteps(input: QuoteStepsInput): readonly QuoteStep[] {
  const hrefs = stepHrefs(input.quoteId);
  const current = input.current ?? 2;
  const settled: Record<QuoteStepNumber, boolean> = {
    1: true,
    2: linesSettled(input.lines.length, input.openRows),
    3: deliverySettled(input.lines.length),
    4: false,
  };
  const step = (
    number: QuoteStepNumber,
    label: string,
    href: string,
    summary: string,
  ): QuoteStep => {
    const done = number === 1 || (number < current && settled[number]);
    return number === current
      ? { number, label, state: 'current', done, summary }
      : { number, label, state: done ? 'done' : 'todo', done, href, summary };
  };
  return [
    step(1, 'Customer', hrefs.customer, input.customerName),
    step(2, 'Lines', hrefs.lines, linesSummary(input.lines.length, input.openRows)),
    step(3, 'Delivery and tax', hrefs.delivery, deliverySummary(input.lines)),
    step(
      4,
      'Review and send',
      hrefs.review,
      reviewSummary(input.lines.length, input.openRows, input.leadTimeDays),
    ),
  ];
}

export function newQuoteSteps(): readonly QuoteStep[] {
  return [
    {
      number: 1,
      label: 'Customer',
      state: 'current',
      done: false,
      summary: 'Pick the account below',
    },
    { number: 2, label: 'Lines', state: 'todo', done: false, summary: linesSummary(0, 0) },
    {
      number: 3,
      label: 'Delivery and tax',
      state: 'todo',
      done: false,
      summary: deliverySummary([]),
    },
    {
      number: 4,
      label: 'Review and send',
      state: 'todo',
      done: false,
      summary: 'Nothing to send yet',
    },
  ];
}

export function linesSettled(priced: number, openRows: number): boolean {
  return priced > 0 && openRows === 0;
}

/**
 * Settled once any line exists. A line cannot be saved without a shipping mode and a tax
 * treatment, so a saved line has already answered step 3.
 */
export function deliverySettled(lineCount: number): boolean {
  return lineCount > 0;
}

export function linesSummary(priced: number, openRows: number): string {
  if (priced === 0) {
    return openRows === 0 ? 'No lines yet' : `${String(openRows)} being added`;
  }
  if (openRows === 0) {
    return `${plural(priced, 'line')}, all priced`;
  }
  return `${String(priced)} priced, ${String(openRows)} being added`;
}

export function deliverySummary(
  lines: readonly Pick<QuoteLine, 'freight' | 'taxStatus'>[],
): string {
  if (lines.length === 0) {
    return 'Nothing to deliver yet';
  }
  const shipping = new Set(lines.map((line) => SHIPPING_SUMMARY[line.freight.mode]));
  const tax = new Set(lines.map((line) => TAX_STATUS_LABELS[line.taxStatus]));
  const shippingWords = shipping.size === 1 ? [...shipping][0] : 'Mixed shipping';
  const taxWords = tax.size === 1 ? [...tax][0] : 'mixed tax';
  return `${shippingWords ?? ''}, ${taxWords ?? ''}`;
}

export function reviewSummary(
  priced: number,
  openRows: number,
  leadTimeDays: number | undefined,
): string {
  if (priced === 0) {
    return `${plural(Math.max(openRows, 1), 'line')} to price`;
  }
  if (leadTimeDays === undefined) {
    return 'Waits for the lead time';
  }
  return 'Everything is in';
}

const SHIPPING_SUMMARY: Record<ShippingMode, string> = {
  pickup: 'Collected at the plant',
  our_vehicle: 'Collected at the warehouse',
  pass_through: 'Delivered',
  carrier: 'Delivered',
};

function plural(count: number, noun: string): string {
  return `${String(count)} ${noun}${count === 1 ? '' : 's'}`;
}
