// Revenue categories and a line's tax treatment. Each line carries a tax treatment: docs/product/requirements.md (R4).
// `REVENUE_CATEGORIES` and `TAX_STATUSES` are mirrored by CHECK constraints in the quoting and orders baselines
// under infra/db/migrations/.
import { z } from 'zod';

export const REVENUE_CATEGORIES = ['print', 'label', 'freight', 'design'] as const;

export const revenueCategorySchema = z.enum(REVENUE_CATEGORIES);

export type RevenueCategory = z.infer<typeof revenueCategorySchema>;

export const FREIGHT_REVENUE_CATEGORY: RevenueCategory = 'freight';

export const TAX_STATUSES = ['id_tax', 'wa_tax', 'non_tax'] as const;

export const taxStatusSchema = z.enum(TAX_STATUSES);

export type TaxStatus = z.infer<typeof taxStatusSchema>;

// The read shape. Requests take `taxJurisdictionKeySchema`, so a stored value outside the key format still reads.
export const taxJurisdictionSchema = z.string().trim().min(1).max(64);

export const WASHINGTON_KEY_FORMAT =
  'WA- and the four-digit DOR location code, such as WA-0202 for Clarkston';

export const TAX_JURISDICTION_KEY_FORMAT = `ID, or ${WASHINGTON_KEY_FORMAT}`;

export const TAX_JURISDICTION_KEY_RULE = `tax jurisdiction must be ${TAX_JURISDICTION_KEY_FORMAT}.`;

export const taxJurisdictionKeySchema = z
  .string()
  .trim()
  .regex(/^(ID|WA-\d{4})$/, TAX_JURISDICTION_KEY_RULE);

export const TAX_STATES = ['ID', 'WA'] as const;
export type TaxState = (typeof TAX_STATES)[number];

export function taxStateOf(jurisdiction: string): TaxState | null {
  const state = jurisdiction.trim().split('-')[0]?.toUpperCase();
  return TAX_STATES.find((candidate) => candidate === state) ?? null;
}

/**
 * True when either side is unknown. It refuses only a jurisdiction whose state differs from the
 * state the line ships to, because tax follows the ship-to address.
 */
export function jurisdictionFitsShipTo(
  jurisdiction: string | undefined,
  shipToState: string | undefined,
): boolean {
  if (jurisdiction === undefined || shipToState === undefined) {
    return true;
  }
  return taxStateOf(jurisdiction) === shipToState.trim().toUpperCase();
}

export function jurisdictionShipToRefusal(jurisdiction: string, shipToState: string): string {
  return (
    `tax jurisdiction "${jurisdiction}" does not belong to ${shipToState.trim().toUpperCase()}, ` +
    'where this line ships - tax follows the ship-to address'
  );
}

// A taxable line names its jurisdiction and a non-taxable line names none. The orders baseline holds the same
// rule as `order_lines_tax_treatment_check` in infra/db/migrations/orders/0000_baseline.sql.
export const lineTaxTreatmentSchema = z
  .object({
    taxStatus: taxStatusSchema,
    taxJurisdiction: taxJurisdictionKeySchema.optional(),
  })
  .refine((value) => (value.taxStatus === 'non_tax') === (value.taxJurisdiction === undefined), {
    error: 'a taxable line requires a jurisdiction, and a non-taxable line must not name one',
    path: ['taxJurisdiction'],
  });

export type LineTaxTreatment = z.infer<typeof lineTaxTreatmentSchema>;

export function isTaxable(status: TaxStatus): boolean {
  return status !== 'non_tax';
}
