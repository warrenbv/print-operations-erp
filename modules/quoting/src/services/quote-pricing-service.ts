// Prices one requested line: costs the roll, counts pallets, picks the tier and calls the pure
// calculation in modules/quoting/src/quote-calculation.ts. Sales prices without waiting on anyone,
// from configured values: docs/product/requirements.md (R3).
import type { QuoteLineCalculation, QuoteLineRequest } from '@erp/types';

import { priceQuoteLine } from '../quote-calculation';
import { palletsForQuantity } from '../roll-geometry';
import { resolveTier } from '../tier-selection';
import type { PricingConfigRepository, PricingTierRepository } from '../ports';
import type { RollCostService } from './roll-cost-service';

// A width with no rolls-per-pallet count has no pallet count. Its tier is chosen as if it filled
// one pallet.
const UNCOUNTED_TIER_PALLETS = 1;

export interface QuotePricingServiceOptions {
  rollCost: RollCostService;
  tiers: PricingTierRepository;
  config: PricingConfigRepository;
}

export class QuotePricingService {
  readonly #rollCost: RollCostService;
  readonly #tiers: PricingTierRepository;
  readonly #config: PricingConfigRepository;

  constructor(options: QuotePricingServiceOptions) {
    this.#rollCost = options.rollCost;
    this.#tiers = options.tiers;
    this.#config = options.config;
  }

  async isStockWidth(gradeId: string, rollWidthIn: number): Promise<boolean | null> {
    return this.#rollCost.isStockWidth(gradeId, rollWidthIn);
  }

  /** Returns null when the grade does not exist. */
  async priceLine(request: QuoteLineRequest): Promise<QuoteLineCalculation | null> {
    const costed = await this.#rollCost.costRollDetailed(request);
    if (costed === null) {
      return null;
    }
    const cost = costed.breakdown;

    const pallets =
      cost.rollsPerPallet === null
        ? null
        : palletsForQuantity(request.quantityRolls, cost.rollsPerPallet);

    const [tiers, config] = await Promise.all([this.#tiers.list(), this.#config.get()]);
    const tier = resolveTier(tiers, pallets ?? UNCOUNTED_TIER_PALLETS, request.tierOverrideCode);

    return priceQuoteLine({
      cost,

      exactTotalCostPerRoll: costed.exactTotalCostPerRoll,
      tier,
      config,
      pallets,
      quantityRolls: request.quantityRolls,
      overwrap: request.overwrap,
      pricingBasis: request.pricingBasis,
      ...(request.overridePricePerRoll === undefined
        ? {}
        : { overridePricePerRoll: request.overridePricePerRoll }),

      ...(request.overridePricePerLb === undefined
        ? {}
        : { overridePricePerLb: request.overridePricePerLb }),

      ...(request.marginOverridePct === undefined
        ? {}
        : { marginOverridePct: request.marginOverridePct }),

      ...(request.orderedWeightLb === undefined
        ? {}
        : { orderedWeightLb: request.orderedWeightLb }),
      freight: request.freight,
    });
  }
}
