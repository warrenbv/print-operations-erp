// Whether a line is priced per roll or per pound. Mirrored by the pricing_basis checks in the quoting, orders
// and crm baselines under infra/db/migrations/.
import { z } from 'zod';

import { toDecimal, type Decimal } from './decimal';

export const PRICING_BASES = ['per_roll', 'per_pound'] as const;
export const pricingBasisSchema = z.enum(PRICING_BASES);
export type PricingBasis = z.infer<typeof pricingBasisSchema>;

/** The product price of a per-pound line, before freight. Does not round. */
export function perPoundProductPrice(productPricePerLb: string, orderedWeightLb: string): Decimal {
  return toDecimal(productPricePerLb).times(toDecimal(orderedWeightLb));
}
