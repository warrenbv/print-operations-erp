// Paper grades and the pricing configuration the roll cost is built from.
// Sales prices a line from these configured values: docs/product/requirements.md (R3). The Billing Manager edits
// them, through `PRICING_CONFIG_WRITE_ROLES` in packages/types/src/roles.ts.
// The build-up: modules/quoting/src/cost-build-up.ts.
import { z } from 'zod';

import { withCustomerDescription } from './customer-part';
import {
  measureSchema,
  moneySchema,
  positiveDecimal,
  poundsPerTonneSchema,
  rateSchema,
  unitCostSchema,
  withinColumn,
} from './decimal';
import { rollWidthSchema } from './roll-width';

// Mirrored by `pallet_fits_product_family_check` in infra/db/migrations/quoting/0000_baseline.sql.
export const PRODUCT_FAMILIES = ['kraft', 'butcher', 'newsprint', 'digital_bond'] as const;

export const productFamilySchema = z.enum(PRODUCT_FAMILIES);

export type ProductFamily = z.infer<typeof productFamilySchema>;

export const PRODUCT_FAMILY_LABELS: Record<ProductFamily, string> = {
  kraft: 'Kraft',
  butcher: 'Butcher',
  newsprint: 'Newsprint',
  digital_bond: 'Digital Bond',
};

// Only these families have a roll code. `rollCode` returns undefined for the others.
export const PRODUCT_FAMILY_CODE_LETTERS: Readonly<Partial<Record<ProductFamily, string>>> = {
  kraft: 'K',
  newsprint: 'N',
};

export function gradeLabel(grade: {
  readonly productFamily: ProductFamily;
  readonly code: string;
}): string {
  return `${PRODUCT_FAMILY_LABELS[grade.productFamily]} — ${grade.code}`;
}

export interface LinePaper {
  readonly productFamily: ProductFamily;
  readonly code: string;
  readonly basisWeightLb: string;
}

export function linePaperOf(
  grade: Pick<Grade, 'productFamily' | 'code' | 'basisWeightLb'>,
): LinePaper {
  return {
    productFamily: grade.productFamily,
    code: grade.code,
    basisWeightLb: grade.basisWeightLb,
  };
}

// A roll's code on quote and order documents: the prefix, the width by the feet, then the
// family letter and the poundage, such as DP/24x1250/K40. The code names one roll size of one grade.
export const ROLL_CODE_PREFIX = 'DP';

function codeDigits(value: string): string {
  const [whole = '0', fraction = ''] = value.trim().split('.');
  const trimmed = fraction.replace(/0+$/, '');
  return trimmed === '' ? whole : `${whole}.${trimmed}`;
}

export function rollCodeWeight(paper: Pick<LinePaper, 'code' | 'basisWeightLb'>): string {
  const poundage = /^\s*(\d+(?:\.\d+)?)/.exec(paper.code)?.[1];
  return codeDigits(poundage ?? paper.basisWeightLb);
}

export function rollCode(
  paper: LinePaper,
  line: { readonly rollWidthIn: number; readonly feetPerRoll?: string | undefined },
): string | undefined {
  const letter = PRODUCT_FAMILY_CODE_LETTERS[paper.productFamily];
  if (letter === undefined || line.feetPerRoll === undefined) {
    return undefined;
  }
  const size = `${String(line.rollWidthIn)}x${codeDigits(line.feetPerRoll)}`;
  return [ROLL_CODE_PREFIX, size, `${letter}${rollCodeWeight(paper)}`].join('/');
}

export function describeGoods(
  spec: string,
  line: {
    readonly customerDescription?: string | undefined;
    readonly rollWidthIn: number;
    readonly feetPerRoll?: string | undefined;
  },
  paper: LinePaper | undefined,
): string {
  if (paper === undefined) {
    return withCustomerDescription(spec, line);
  }
  const described = withCustomerDescription(`${gradeLabel(paper)} · ${spec}`, line);
  const code = rollCode(paper, line);
  return code === undefined ? described : `${code} · ${described}`;
}

export const gradeIdSchema = z.string().min(1);

const gradeCode = z.string().trim().min(1).max(64);

export const gradeFootageSchema = z.object({
  variant: z.string().trim().min(1).max(32),
  label: z.string().trim().min(1).max(64),
  feetPerRoll: measureSchema,
});

export type GradeFootage = z.infer<typeof gradeFootageSchema>;

export const gradeFootageRequestSchema = gradeFootageSchema.extend({
  feetPerRoll: positiveDecimal(measureSchema, 'feet per roll', 'measure'),
});

export const gradeWidthSchema = z.object({
  rollWidthIn: rollWidthSchema,
  rollsPerPallet: z.number().int().positive().max(10_000).nullable().default(null),
});

export type GradeWidth = z.infer<typeof gradeWidthSchema>;

export const gradeSchema = z.object({
  id: gradeIdSchema,
  productFamily: productFamilySchema,
  code: gradeCode,

  basisWeightLb: measureSchema,

  reamAreaDivisor: measureSchema,

  paperCostPerTonne: moneySchema,
  footages: z.array(gradeFootageSchema),

  widths: z.array(gradeWidthSchema).default([]),

  // Two edits to one grade cannot silently overwrite each other: docs/decisions/006-optimistic-concurrency.md.
  lockVersion: z.number().int().min(1).default(1),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export type Grade = z.infer<typeof gradeSchema>;

export const DEFAULT_REAM_AREA_DIVISOR = '432.0000';

export const createGradeRequestSchema = z.object({
  productFamily: productFamilySchema,
  code: gradeCode,
  basisWeightLb: positiveDecimal(measureSchema, 'basis weight', 'measure'),

  reamAreaDivisor: positiveDecimal(measureSchema, 'ream area divisor', 'measure').default(
    DEFAULT_REAM_AREA_DIVISOR,
  ),

  paperCostPerTonne: positiveDecimal(moneySchema, 'paper cost', 'money'),
  footages: z.array(gradeFootageRequestSchema).default([]),

  widths: z.array(gradeWidthSchema).optional(),
});

export type CreateGradeRequest = z.infer<typeof createGradeRequestSchema>;

export const updateGradeRequestSchema = z.object({
  code: gradeCode.optional(),
  basisWeightLb: positiveDecimal(measureSchema, 'basis weight', 'measure').optional(),
  reamAreaDivisor: positiveDecimal(measureSchema, 'ream area divisor', 'measure').optional(),
  paperCostPerTonne: positiveDecimal(moneySchema, 'paper cost', 'money').optional(),
  footages: z.array(gradeFootageRequestSchema).optional(),

  widths: z.array(gradeWidthSchema).optional(),

  lockVersion: z.number().int().min(1),
});

export type UpdateGradeRequest = z.infer<typeof updateGradeRequestSchema>;

const boundedRate = (subject: string, { max, because }: { max: number; because?: string }) =>
  rateSchema.refine(
    (v) => {
      const n = Number(v);
      return n >= 0 && n < max;
    },
    {
      error:
        `${subject} must be at least 0 and less than ${String(max)}` +
        (because === undefined ? '' : ` — ${because}`),
    },
  );

// The build-up divides by one minus the waste and one minus the floor, so each must stay below 1.
export const configWastePctSchema = boundedRate('waste', { max: 1 });

export const configMarginFloorPctSchema = boundedRate('margin floor', { max: 1 });

export const configOverwrapSurchargePctSchema = boundedRate('overwrap surcharge', {
  max: 1000,
  because: 'the column holds three digits before the decimal point',
});

export const pricingConfigValuesSchema = z.object({
  poundsPerTonne: poundsPerTonneSchema,

  wastePct: configWastePctSchema,

  coreCostPerCore: moneySchema,

  coreReferenceLengthIn: measureSchema,

  plugCostPerPlug: unitCostSchema,

  plugsPerRoll: z.number().int().nonnegative().max(100),

  palletCost: moneySchema,

  marginFloorPct: configMarginFloorPctSchema,

  overwrapSurchargePct: configOverwrapSurchargePctSchema,

  ourVehicleFreightRate: moneySchema,
});

export type PricingConfigValues = z.infer<typeof pricingConfigValuesSchema>;

export const pricingConfigSchema = pricingConfigValuesSchema.extend({
  updatedAt: z.iso.datetime(),

  updatedBy: z.string().min(1).nullable(),
});

export type PricingConfig = z.infer<typeof pricingConfigSchema>;

export const updatePricingConfigRequestSchema = z.object({
  poundsPerTonne: withinColumn(
    poundsPerTonneSchema,
    'poundsPerTonne',
    'pounds per tonne',
  ).optional(),
  wastePct: configWastePctSchema.optional(),
  coreCostPerCore: withinColumn(moneySchema, 'money', 'core cost').optional(),
  coreReferenceLengthIn: withinColumn(measureSchema, 'measure', 'core reference length').optional(),
  plugCostPerPlug: withinColumn(unitCostSchema, 'unitCost', 'plug cost').optional(),
  plugsPerRoll: z.number().int().nonnegative().max(100).optional(),
  palletCost: withinColumn(moneySchema, 'money', 'pallet cost').optional(),
  marginFloorPct: configMarginFloorPctSchema.optional(),
  overwrapSurchargePct: configOverwrapSurchargePctSchema.optional(),
  ourVehicleFreightRate: withinColumn(moneySchema, 'money', 'our-vehicle freight rate').optional(),
});

export type UpdatePricingConfigRequest = z.infer<typeof updatePricingConfigRequestSchema>;

export const pricingConfigChangeSchema = pricingConfigValuesSchema.extend({
  at: z.iso.datetime(),

  actor: z.string().min(1),
});

export type PricingConfigChange = z.infer<typeof pricingConfigChangeSchema>;

export const pricingConfigHistoryResponseSchema = z.object({
  items: z.array(pricingConfigChangeSchema),
});

export type PricingConfigHistoryResponse = z.infer<typeof pricingConfigHistoryResponseSchema>;

export const gradeListResponseSchema = z.object({
  items: z.array(gradeSchema),
});

export type GradeListResponse = z.infer<typeof gradeListResponseSchema>;
