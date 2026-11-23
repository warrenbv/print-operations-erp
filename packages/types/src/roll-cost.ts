// The roll cost request, the cost breakdown and pallet fits.
// The build-up that fills `rollCostBreakdownSchema` is modules/quoting/src/cost-build-up.ts:
// docs/product/requirements.md (R3).
import { z } from 'zod';

import {
  measureSchema,
  moneySchema,
  positiveDecimal,
  toDecimal,
  unitCostSchema,
  withinColumn,
} from './decimal';
import { productFamilySchema } from './grade';
import { rollWidthSchema } from './roll-width';

export const palletFitSchema = z.object({
  id: z.string().min(1),
  productFamily: productFamilySchema,

  rollWidthIn: rollWidthSchema,

  rollsPerPallet: z.number().int().positive().max(10_000),
  updatedAt: z.iso.datetime(),
});

export type PalletFit = z.infer<typeof palletFitSchema>;

function nonNegativeCostPerTon(field: string) {
  return withinColumn(
    moneySchema.refine((value) => toDecimal(value).gte(0), {
      error: `${field} cannot be negative`,
    }),
    'money',
    field,
  );
}

export const rollCostRequestSchema = z.object({
  gradeId: z.string().min(1),

  footageVariant: z.string().trim().min(1).max(32),

  rollWidthIn: rollWidthSchema,

  feetPerRollOverride: positiveDecimal(measureSchema, 'custom length', 'measure').optional(),

  convertCostPerTon: nonNegativeCostPerTon('converting cost per US ton').optional(),

  printCostPerTon: nonNegativeCostPerTon('print cost per US ton').optional(),
});

export type RollCostRequest = z.infer<typeof rollCostRequestSchema>;

export const rollCostBreakdownSchema = z.object({
  rollWeightLb: measureSchema,

  paperCostPerLb: unitCostSchema,
  paperCostPerRoll: moneySchema,
  hardwareCostPerRoll: moneySchema,
  addOnCostPerRoll: moneySchema,
  totalCostPerRoll: moneySchema,

  rollsPerPallet: z.number().int().positive().nullable(),

  feetPerRoll: measureSchema,
});

export type RollCostBreakdown = z.infer<typeof rollCostBreakdownSchema>;

export const PALLETS_NOT_COUNTED = 'not counted';

export function palletsText(pallets: number | null): string {
  if (pallets === null) {
    return `pallets ${PALLETS_NOT_COUNTED}`;
  }
  return `${String(pallets)} pallet${pallets === 1 ? '' : 's'}`;
}

export function rollsPerPalletText(rollsPerPallet: number | null): string {
  return rollsPerPallet === null
    ? `rolls per pallet ${PALLETS_NOT_COUNTED}`
    : `${String(rollsPerPallet)} / pallet`;
}

export const palletFitListResponseSchema = z.object({
  items: z.array(palletFitSchema),
});

export type PalletFitListResponse = z.infer<typeof palletFitListResponseSchema>;
