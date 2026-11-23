// Tax rates: imported rows selected by effective date, never a live lookup: docs/decisions/README.md.
// `TAX_RATE_SOURCES` is mirrored by `tax_rates_source_check` in infra/db/migrations/quoting/0000_baseline.sql.
// The service: modules/quoting/src/services/tax-rate-service.ts.
import { z } from 'zod';

import { rateSchema } from './decimal';
import { taxJurisdictionSchema } from './revenue';

export const TAX_RATE_SOURCES = ['statute', 'wa_dor'] as const;
export const taxRateSourceSchema = z.enum(TAX_RATE_SOURCES);
export type TaxRateSource = z.infer<typeof taxRateSourceSchema>;

export const taxRateSchema = z.object({
  id: z.string().min(1),
  jurisdiction: taxJurisdictionSchema,

  rate: rateSchema,

  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be a calendar date, YYYY-MM-DD'),
  source: taxRateSourceSchema,

  name: z.string().trim().min(1).max(120).optional(),

  stateRate: rateSchema.optional(),
  localRate: rateSchema.optional(),
  rtaRate: rateSchema.optional(),
  createdAt: z.iso.datetime(),
});

export type TaxRate = z.infer<typeof taxRateSchema>;

export type TaxRateParts = Pick<TaxRate, 'stateRate' | 'localRate' | 'rtaRate'>;

export function taxRatePartsOf(
  row: TaxRateParts,
): { stateRate: string; localRate: string; rtaRate: string } | null {
  const { stateRate, localRate, rtaRate } = row;
  return stateRate === undefined || localRate === undefined || rtaRate === undefined
    ? null
    : { stateRate, localRate, rtaRate };
}

export const newTaxRateSchema = taxRateSchema.omit({ id: true, createdAt: true });

export type NewTaxRate = z.infer<typeof newTaxRateSchema>;

export const taxRateListResponseSchema = z.object({
  items: z.array(taxRateSchema),
});

export type TaxRateListResponse = z.infer<typeof taxRateListResponseSchema>;

export const taxRateSummarySchema = taxRateSchema.extend({
  stale: z.boolean(),
});

export type TaxRateSummary = z.infer<typeof taxRateSummarySchema>;

export const taxRateSummaryListResponseSchema = z.object({
  asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),

  currentQuarterStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  items: z.array(taxRateSummarySchema),
});

export type TaxRateSummaryListResponse = z.infer<typeof taxRateSummaryListResponseSchema>;

export const TAX_RATE_IMPORT_FORMATS = ['erp_rows', 'wa_dor_rates'] as const;
export const taxRateImportFormatSchema = z.enum(TAX_RATE_IMPORT_FORMATS);
export type TaxRateImportFormat = z.infer<typeof taxRateImportFormatSchema>;

export const importTaxRatesRequestSchema = z.object({
  text: z.string().max(2_000_000),
  format: taxRateImportFormatSchema,

  // An import previews unless the caller asks it to write.
  dryRun: z.boolean().default(true),
});

export type ImportTaxRatesRequest = z.infer<typeof importTaxRatesRequestSchema>;

export const TAX_RATE_ROW_VERDICTS = ['new', 'unchanged', 'conflict'] as const;
export const taxRateRowVerdictSchema = z.enum(TAX_RATE_ROW_VERDICTS);
export type TaxRateRowVerdict = z.infer<typeof taxRateRowVerdictSchema>;

export const taxRatePreviewRowSchema = z.object({
  jurisdiction: taxJurisdictionSchema,
  rate: rateSchema,
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  source: taxRateSourceSchema,
  name: z.string().min(1).max(120).optional(),

  stateRate: rateSchema.optional(),
  localRate: rateSchema.optional(),
  rtaRate: rateSchema.optional(),
  verdict: taxRateRowVerdictSchema,

  storedRate: rateSchema.optional(),

  fillsParts: z.literal(true).optional(),
});

export type TaxRatePreviewRow = z.infer<typeof taxRatePreviewRowSchema>;

export const taxRateImportIssueSchema = z.object({
  line: z.number().int().positive(),
  message: z.string().min(1),
});

export type TaxRateImportIssue = z.infer<typeof taxRateImportIssueSchema>;

export const importTaxRatesResponseSchema = z.object({
  dryRun: z.boolean(),

  refused: z.boolean(),
  inserted: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),

  filled: z.number().int().nonnegative(),
  rows: z.array(taxRatePreviewRowSchema),
  issues: z.array(taxRateImportIssueSchema),
});

export type ImportTaxRatesResponse = z.infer<typeof importTaxRatesResponseSchema>;
