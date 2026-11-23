// Pricing tiers: a margin chosen by pallet count or named by hand on a line, and the history of their changes.
// Selection and the cost multiplier: modules/quoting/src/tier-selection.ts. The Billing Manager edits tiers:
// docs/product/roles.md.
import { z } from 'zod';

import { rateSchema } from './decimal';

export const pricingTierIdSchema = z.string().min(1);

export const tierCodeSchema = z
  .string()
  .trim()
  .min(1)
  .max(32)
  .regex(/^[a-z][a-z0-9_]*$/, 'expected lower_snake_case');

const tierName = z.string().trim().min(1).max(64);

// Below 1, because the multiplier divides by one minus the margin.
export const tierMarginSchema = rateSchema.refine(
  (v) => {
    const n = Number(v);
    return n >= 0 && n < 1;
  },
  { error: 'margin must be at least 0 and less than 1' },
);

const minPallets = z.number().int().nonnegative().max(100_000);

export const pricingTierValuesSchema = z.object({
  name: tierName,
  marginPct: tierMarginSchema,
  minPallets,
});

export type PricingTierValues = z.infer<typeof pricingTierValuesSchema>;

export const pricingTierSchema = pricingTierValuesSchema.extend({
  id: pricingTierIdSchema,
  code: tierCodeSchema,

  isListTier: z.boolean(),

  updatedBy: z.string().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export type PricingTier = z.infer<typeof pricingTierSchema>;

export const createPricingTierRequestSchema = pricingTierValuesSchema.extend({
  code: tierCodeSchema,
});

export type CreatePricingTierRequest = z.infer<typeof createPricingTierRequestSchema>;

export const updatePricingTierRequestSchema = pricingTierValuesSchema.partial();

export type UpdatePricingTierRequest = z.infer<typeof updatePricingTierRequestSchema>;

export const pricingTierChangeSchema = pricingTierValuesSchema.extend({
  tierCode: tierCodeSchema,
  at: z.iso.datetime(),

  actor: z.string().min(1),
});

export type PricingTierChange = z.infer<typeof pricingTierChangeSchema>;

export const pricingTierHistoryResponseSchema = z.object({
  items: z.array(pricingTierChangeSchema),
});

export type PricingTierHistoryResponse = z.infer<typeof pricingTierHistoryResponseSchema>;

// Mirrored by `quote_lines_tier_source_check` in infra/db/migrations/quoting/0000_baseline.sql.
export const tierSelectionSourceSchema = z.enum(['auto', 'override']);

export type TierSelectionSource = z.infer<typeof tierSelectionSourceSchema>;

export const tierSelectionSchema = z.object({
  tier: pricingTierSchema,
  source: tierSelectionSourceSchema,
});

export type TierSelection = z.infer<typeof tierSelectionSchema>;

export const selectTierRequestSchema = z.object({
  pallets: minPallets,
  overrideCode: tierCodeSchema.optional(),
});

export type SelectTierRequest = z.infer<typeof selectTierRequestSchema>;

export const pricingTierListResponseSchema = z.object({
  items: z.array(pricingTierSchema),
});

export type PricingTierListResponse = z.infer<typeof pricingTierListResponseSchema>;
