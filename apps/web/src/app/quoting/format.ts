// Labels and short phrases the quoting screens share. Order and customer pages import them too.
import { DELIVERY_METHOD_LABELS, formatRatePercent, freightKnowledge } from '@erp/types';
import type {
  PricingBasis,
  QuoteOverrideDecision,
  QuoteOverrideDecisionKind,
  QuoteStatus,
  ShippingMode,
} from '@erp/types';

export const QUOTE_STATUS_LABELS: Record<QuoteStatus, string> = {
  draft: 'Draft',
  override_requested: 'Approval requested',
  quoted: 'Quoted',
  superseded: 'Superseded',
  closed_lost: 'Closed (lost)',
};

export function quoteWithOrdersWords(
  status: Extract<QuoteStatus, 'quoted' | 'superseded'>,
  orderCount: number,
): string {
  const orders = orderCount === 1 ? '1 order' : `${String(orderCount)} orders`;
  return status === 'quoted' ? `Quoted, ${orders} so far` : `Superseded, ${orders}`;
}

export { PRODUCT_FAMILY_LABELS } from '@erp/types';

export const SHIPPING_MODE_LABELS: Record<ShippingMode, string> = {
  pickup: DELIVERY_METHOD_LABELS.pickup,
  our_vehicle: DELIVERY_METHOD_LABELS.our_vehicle,
  pass_through: 'Pass-thru',
  carrier: 'Freight',
};

export const PRICING_BASIS_LABELS: Record<PricingBasis, string> = {
  per_roll: 'Per roll',
  per_pound: 'Per pound',
};

/** The words after a price whose freight is not fully known: docs/product/requirements.md (R4). */
export function freightCaveat(knowledge: ReturnType<typeof freightKnowledge>): string | undefined {
  return knowledge === 'unknown'
    ? ' (excl. freight TBD)'
    : knowledge === 'partial'
      ? ' (excl. last-leg freight)'
      : undefined;
}

export function marginEnteredWords(marginOverridePct: string): string {
  return `margin entered manually, ${formatRatePercent(marginOverridePct)}`;
}

export { REVENUE_CATEGORY_LABELS, TAX_STATUS_LABELS } from '../../lib/line-labels';

const DECISION_LABELS: Record<QuoteOverrideDecisionKind, string> = {
  requested: 'Requested',
  approved: 'Approved',
  rejected: 'Rejected',
  revoked: 'Revoked',
};

export function decisionLabel(decision: Pick<QuoteOverrideDecision, 'decision' | 'kind'>): string {
  const word = DECISION_LABELS[decision.decision];
  return decision.kind === 'floor' ? `Floor override ${word.toLowerCase()}` : word;
}
