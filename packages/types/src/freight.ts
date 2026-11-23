// Freight by shipping mode: the input a line takes, the result pricing returns, and the labels documents print.
// Freight is priced by mode and kept apart from the roll price: docs/product/requirements.md (R4).
// The calculation: modules/quoting/src/freight.ts. `SHIPPING_MODES` is mirrored by the freight_mode checks in the
// quoting, orders and crm baselines under infra/db/migrations/.
import { z } from 'zod';

import { moneySchema, rateSchema, toDecimal, toMoney, withinColumn } from './decimal';
import type { PricingBasis } from './pricing-basis';
import { PLANT_SITE, WAREHOUSE_SITE } from './sites';

export const SHIPPING_MODES = ['pickup', 'our_vehicle', 'pass_through', 'carrier'] as const;
export const shippingModeSchema = z.enum(SHIPPING_MODES);
export type ShippingMode = z.infer<typeof shippingModeSchema>;

export const DELIVERY_METHOD_LABELS: Readonly<Record<ShippingMode, string>> = {
  pickup: `Customer pickup - ${PLANT_SITE.name}`,
  our_vehicle: `Customer pickup - ${WAREHOUSE_SITE.name}`,

  pass_through: 'Delivered',

  carrier: 'Shipped via freight carrier',
};

export function deliveryMethodLabel(mode: ShippingMode): string {
  return DELIVERY_METHOD_LABELS[mode];
}

export const freightMarginPctSchema = rateSchema.refine(
  (v) => {
    const n = Number(v);
    return n >= 0 && n < 1;
  },
  { error: 'freight margin must be at least 0 and less than 1' },
);

/**
 * A carrier bid may be left out until it arrives. The line's freight is then pending until the bid is entered:
 * docs/product/requirements.md (R4).
 */
export const freightInputSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('pickup') }),
  z.object({
    mode: z.literal('our_vehicle'),
    rateOverride: withinColumn(moneySchema, 'money', 'freight rate').optional(),
  }),
  z.object({
    mode: z.literal('pass_through'),
    rateOverride: withinColumn(moneySchema, 'money', 'freight rate').optional(),
    carrierBid: withinColumn(moneySchema, 'money', 'carrier bid').optional(),
  }),
  z.object({
    mode: z.literal('carrier'),
    carrierBid: withinColumn(moneySchema, 'money', 'carrier bid').optional(),
    freightMarginPct: freightMarginPctSchema.optional(),
  }),
]);

export type FreightInput = z.infer<typeof freightInputSchema>;

export const freightResultSchema = z.object({
  mode: shippingModeSchema,

  cost: moneySchema,

  margin: moneySchema,

  invoiceTotal: moneySchema,

  pending: z.boolean(),
});

export type FreightResult = z.infer<typeof freightResultSchema>;

export function freightKnowledge(result: FreightResult): 'known' | 'partial' | 'unknown' {
  if (!result.pending) return 'known';
  return result.mode === 'pass_through' ? 'partial' : 'unknown';
}

export function freightInRollPriceApplies(
  flag: boolean,
  lines: readonly { pricingBasis: PricingBasis }[],
): boolean {
  return flag && !lines.some((line) => line.pricingBasis === 'per_pound');
}

export function deliveredPricePerRollOf(line: {
  extendedPrice: string;
  quantityRolls: number;
}): string {
  return toMoney(toDecimal(line.extendedPrice).div(line.quantityRolls));
}
