// The pricing tier table, owned by the Billing Manager: docs/product/roles.md. Each update is
// logged with the tier's previous values. The API restricts writes to the pricing configuration
// roles.
import type {
  CreatePricingTierRequest,
  PricingTier,
  PricingTierChange,
  SelectTierRequest,
  TierSelection,
  UpdatePricingTierRequest,
} from '@erp/types';

import { NoZeroThresholdTierError, type Clock, type PricingTierRepository } from '../ports';
import { resolveTier } from '../tier-selection';

export const PRICING_TIER_HISTORY_LIMIT = 200;

export interface PricingTierServiceOptions {
  tiers: PricingTierRepository;
  clock: Clock;
}

export class PricingTierService {
  readonly #tiers: PricingTierRepository;
  readonly #clock: Clock;

  constructor(options: PricingTierServiceOptions) {
    this.#tiers = options.tiers;
    this.#clock = options.clock;
  }

  async list(): Promise<readonly PricingTier[]> {
    return this.#tiers.list();
  }

  async history(limit = PRICING_TIER_HISTORY_LIMIT): Promise<readonly PricingTierChange[]> {
    return this.#tiers.history(limit);
  }

  async create(request: CreatePricingTierRequest, createdBy: string): Promise<PricingTier> {
    return this.#tiers.create(request, createdBy, this.#clock.now());
  }

  async update(
    code: string,
    patch: UpdatePricingTierRequest,
    updatedBy: string,
  ): Promise<PricingTier | null> {
    // The table must keep a tier that starts at zero pallets, so every quantity has a tier.
    const movesThreshold = patch.minPallets;
    if (movesThreshold !== undefined) {
      const tiers = await this.#tiers.list();

      if (tiers.some((tier) => tier.code === code)) {
        const after = tiers.map((tier) => (tier.code === code ? movesThreshold : tier.minPallets));
        if (!after.includes(0)) {
          throw new NoZeroThresholdTierError();
        }
      }
    }
    return this.#tiers.update(code, patch, this.#clock.now(), updatedBy);
  }

  async select(request: SelectTierRequest): Promise<TierSelection> {
    const tiers = await this.#tiers.list();
    return resolveTier(tiers, request.pallets, request.overrideCode);
  }
}
