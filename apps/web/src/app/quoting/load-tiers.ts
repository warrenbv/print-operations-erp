// Loads the pricing tiers from the quoting API.
import { pricingTierListResponseSchema, type PricingTier } from '@erp/types';

import { fetchParsed } from '../../lib/fetch-parsed';

export async function loadTiers(): Promise<PricingTier[]> {
  return [...(await fetchParsed('/quoting/tiers', pricingTierListResponseSchema)).items];
}
