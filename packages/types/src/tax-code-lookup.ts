// The address lookup that fills a line's tax jurisdiction key. Rates come from imported rows: docs/decisions/README.md.
// `ourRate` is the imported rate stored for the key it found. `stateRate` comes from the lookup itself.
// The service: modules/quoting/src/services/tax-code-lookup-service.ts.
import { z } from 'zod';

import { rateSchema } from './decimal';

export const taxCodeLookupRequestSchema = z.object({
  line1: z.string().trim().max(200).default(''),
  city: z.string().trim().max(120).default(''),

  postalCode: z.string().trim().max(10).default(''),
  state: z.string().trim().max(2).default(''),
});

export type TaxCodeLookupRequest = z.infer<typeof taxCodeLookupRequestSchema>;

export const TAX_CODE_LOOKUP_OUTCOMES = [
  'matched',
  'matched_zip4',
  'corrected',
  'zip_only',
  'not_found',
  'not_loaded',
  'unavailable',
  'not_washington',
  'incomplete_address',
] as const;
export const taxCodeLookupOutcomeSchema = z.enum(TAX_CODE_LOOKUP_OUTCOMES);
export type TaxCodeLookupOutcome = z.infer<typeof taxCodeLookupOutcomeSchema>;

export const taxCodeLookupResponseSchema = z.object({
  outcome: taxCodeLookupOutcomeSchema,

  locationCode: z
    .string()
    .regex(/^\d{4}$/)
    .optional(),

  key: z
    .string()
    .regex(/^WA-\d{4}$/)
    .optional(),

  name: z.string().min(1).max(120).optional(),

  ourRate: rateSchema.optional(),

  effectiveFrom: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),

  stateRate: rateSchema.optional(),
});

export type TaxCodeLookupResponse = z.infer<typeof taxCodeLookupResponseSchema>;

const FILLS: ReadonlySet<TaxCodeLookupOutcome> = new Set(['matched', 'matched_zip4', 'corrected']);

export function taxCodeLookupFills(
  answer: TaxCodeLookupResponse,
): answer is TaxCodeLookupResponse & { key: string } {
  return FILLS.has(answer.outcome) && answer.key !== undefined;
}
