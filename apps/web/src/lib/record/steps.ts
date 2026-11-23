// The step strip on quote and order pages, Quote, Order and Confirmed, and the step each status sits on.
// The strip shows where the record stands: docs/product/requirements.md (R12).
import type { OrderStatus, QuoteStatus } from '@erp/types';

import { orderPage, quotePage } from '../work/work';

export const STEPS = ['Quote', 'Order', 'Confirmed'] as const;

export type StepLabel = (typeof STEPS)[number];

// A superseded or lost quote is off the line and sits on no step.
const QUOTE_STEP: Record<QuoteStatus, StepLabel | null> = {
  draft: 'Quote',
  override_requested: 'Quote',
  quoted: 'Quote',
  superseded: null,
  closed_lost: null,
};

const ORDER_STEP: Record<OrderStatus, StepLabel> = {
  converted: 'Order',
  confirmed: 'Confirmed',
};

export function stepOf(kind: 'quote', status: QuoteStatus): StepLabel | null;
export function stepOf(kind: 'order', status: OrderStatus): StepLabel;
export function stepOf(
  kind: 'quote' | 'order',
  status: QuoteStatus | OrderStatus,
): StepLabel | null {
  switch (kind) {
    case 'quote':
      return QUOTE_STEP[status as QuoteStatus];
    case 'order':
      return ORDER_STEP[status as OrderStatus];
  }
}

export function stepIndex(label: StepLabel): number {
  return STEPS.indexOf(label);
}

export interface StepRecords {
  readonly quoteId: string | null;
  readonly orderId: string | null;
}

// A step links to its record only once the record has reached it.
export function stepHref(
  label: StepLabel,
  reached: boolean,
  records: StepRecords,
): string | undefined {
  return (reached ? recordHref(label, records) : null) ?? undefined;
}

function recordHref(label: StepLabel, records: StepRecords): string | null {
  const { quoteId, orderId } = records;
  switch (label) {
    case 'Quote':
      return quoteId === null ? null : quotePage(quoteId);
    case 'Order':
    case 'Confirmed':
      return orderId === null ? null : orderPage(orderId);
  }
}
