// The line input Sales submits, the calculation pricing returns, and the floor functions both sides share.
// The price build-up is described in docs/product/requirements.md (R3).
// The pricing that fills these shapes: modules/quoting/src/quote-calculation.ts.
import { z } from 'zod';

import { lineTaxTreatmentSchema, revenueCategorySchema } from './revenue';

import {
  measureSchema,
  moneySchema,
  positiveDecimal,
  rateSchema,
  toDecimal,
  toMoneyRoundedUp,
  toRate,
  withinColumn,
  type Decimal,
} from './decimal';
import { customerDescriptionSchema, customerPartNumberSchema } from './customer-part';
import { deliveryAddressSchema } from './delivery-address';
import { freightInputSchema, freightResultSchema } from './freight';
import { pricingBasisSchema } from './pricing-basis';
import { rollCostBreakdownSchema, rollCostRequestSchema } from './roll-cost';
import { refineCustomWidthWhole } from './roll-width';
import { tierSelectionSchema } from './pricing-tier';

// How a line's price was reached: the tier, a hand-set price, a margin entered by hand, or the customer's
// agreed price. Mirrored by `quote_lines_price_source_check` in infra/db/migrations/quoting/0000_baseline.sql.
export const PRICE_SOURCES = ['tier', 'manual', 'margin', 'agreed'] as const;

export const priceSourceSchema = z.enum(PRICE_SOURCES);

export type PriceSource = z.infer<typeof priceSourceSchema>;

export const MARGIN_ENTERED_MAX = '0.950000';

export const marginOverridePctSchema = rateSchema
  .refine((value) => toDecimal(value).gt(0), {
    error: 'margin entered manually must be more than 0',
  })
  .refine((value) => toDecimal(value).lte(MARGIN_ENTERED_MAX), {
    error: 'margin entered manually can be at most 95%',
  })
  // A ratio with three places is a percent with one.
  .refine((value) => toDecimal(value).times(1000).mod(1).eq(0), {
    error: 'margin entered manually must be a percent to one decimal place',
  });

export const quoteLineRequestSchema = rollCostRequestSchema.extend({
  quantityRolls: z.number().int().positive().max(1_000_000),

  tierOverrideCode: z.string().trim().min(1).max(32).optional(),

  overwrap: z.boolean().default(false),

  pricingBasis: pricingBasisSchema.default('per_roll'),

  orderedWeightLb: positiveDecimal(measureSchema, 'pounds ordered', 'measure').optional(),

  overridePricePerRoll: withinColumn(moneySchema, 'money', 'override price').optional(),

  overridePricePerLb: withinColumn(moneySchema, 'money', 'hand-set price per pound').optional(),

  marginOverridePct: marginOverridePctSchema.optional(),

  freight: freightInputSchema.default({ mode: 'pickup' }),

  deliveryAddress: deliveryAddressSchema.optional(),
});

export type QuoteLineRequest = z.infer<typeof quoteLineRequestSchema>;

export const quoteLineInputSchema = quoteLineRequestSchema
  .extend({
    customWidth: z.boolean().optional(),

    revenueCategory: revenueCategorySchema.default('print'),

    taxTreatment: lineTaxTreatmentSchema,

    printed: z.boolean().default(false),

    customerPartNumber: customerPartNumberSchema.optional(),

    customerDescription: customerDescriptionSchema.optional(),
  })
  .superRefine(refineCustomWidthWhole);

export type QuoteLineInput = z.infer<typeof quoteLineInputSchema>;

export const floorStatusSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('ok') }),
  z.object({
    status: z.literal('below_floor'),

    floorPct: rateSchema,

    minimumPricePerRoll: moneySchema,
  }),
]);

export type FloorStatus = z.infer<typeof floorStatusSchema>;

export const quoteLineCalculationSchema = z.object({
  cost: rollCostBreakdownSchema,

  tier: tierSelectionSchema,

  pallets: z.number().int().nonnegative().nullable(),
  quantityRolls: z.number().int().positive(),

  orderedWeightLb: measureSchema.optional(),

  basePricePerRoll: moneySchema,

  pricePerRoll: moneySchema,

  priceSource: priceSourceSchema,

  marginPricePerRoll: moneySchema.optional(),

  deliveredPricePerRoll: moneySchema,

  marginPct: rateSchema,
  floor: floorStatusSchema,

  extendedPrice: moneySchema,
  extendedCost: moneySchema,

  extendedMargin: moneySchema,

  freight: freightResultSchema,

  estimatedWeightLb: measureSchema,

  pricePerLb: moneySchema,

  effectivePricePerLb: moneySchema,

  pricingBasis: pricingBasisSchema,

  basePricePerLb: moneySchema.optional(),

  productPricePerLb: moneySchema.optional(),
});

export type QuoteLineCalculation = z.infer<typeof quoteLineCalculationSchema>;

/** Margin as a ratio of price, one minus cost over price. Does not round. Throws on a zero price. */
export function marginPct(totalCost: Decimal, price: Decimal): Decimal {
  if (price.eq(0)) {
    throw new RangeError('cannot compute margin against a price of zero');
  }
  return toDecimal('1').minus(totalCost.div(price));
}

/**
 * The floor verdict for one line. Below the floor it carries the lowest price that clears it, rounded
 * up at money scale so that price really clears it. Throws when the floor is 1 or more.
 * A line below the floor blocks sending, and no approval releases it: docs/product/requirements.md (R6).
 */
export function evaluateFloor(totalCost: Decimal, margin: Decimal, floorPct: string): FloorStatus {
  const floor = toDecimal(floorPct);
  if (margin.gte(floor)) {
    return { status: 'ok' };
  }

  const headroom = toDecimal('1').minus(floor);
  if (headroom.lte(0)) {
    throw new RangeError(
      `marginFloorPct ${floorPct} must be less than 1 — no price achieves a 100% margin`,
    );
  }

  return {
    status: 'below_floor',
    floorPct: toRate(floor),

    minimumPricePerRoll: toMoneyRoundedUp(totalCost.div(headroom)),
  };
}
