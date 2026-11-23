// The paper cost figures an order line keeps from its quote line's cost build-up.
// They are optional on an order line, and `paperCostBasisOf` returns them only when all four are present.
import { measureSchema, moneySchema, unitCostSchema } from './decimal';
import { z } from 'zod';

export const paperCostBasisSchema = z.object({
  rollWeightLb: measureSchema,

  feetPerRoll: measureSchema,

  paperCostPerLb: unitCostSchema,

  paperCostPerRoll: moneySchema,
});

export type PaperCostBasis = z.infer<typeof paperCostBasisSchema>;

export const paperCostBasisColumns = {
  rollWeightLb: measureSchema.optional(),
  feetPerRoll: measureSchema.optional(),

  paperCostPerLb: unitCostSchema.optional(),
  paperCostPerRoll: moneySchema.optional(),
} as const;

export function paperCostBasisOf(line: {
  rollWeightLb?: string | undefined;
  feetPerRoll?: string | undefined;
  paperCostPerLb?: string | undefined;
  paperCostPerRoll?: string | undefined;
}): PaperCostBasis | undefined {
  const { rollWeightLb, feetPerRoll, paperCostPerLb, paperCostPerRoll } = line;

  if (
    rollWeightLb === undefined ||
    feetPerRoll === undefined ||
    paperCostPerLb === undefined ||
    paperCostPerRoll === undefined
  ) {
    return undefined;
  }

  return { rollWeightLb, feetPerRoll, paperCostPerLb, paperCostPerRoll };
}
