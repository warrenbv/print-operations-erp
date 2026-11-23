// The in-memory adapter for `PricingConfigRepository`. Contract:
// modules/quoting/test/contracts/pricing-config-repository.contract.ts.
import type { PricingConfig, PricingConfigChange } from '@erp/types';

import { pricingConfigActor, type PricingConfigRepository } from '../../ports';

// Fictional reference values. They equal the pricing_config row seeded by
// infra/db/migrations/quoting/0000_baseline.sql.
export const DEFAULT_PRICING_CONFIG = {
  poundsPerTonne: '2204.62262185',
  wastePct: '0.020000',
  coreCostPerCore: '2.0000',
  coreReferenceLengthIn: '48.0000',
  plugCostPerPlug: '0.05000000',
  plugsPerRoll: 2,
  palletCost: '10.0000',
  marginFloorPct: '0.120000',
  overwrapSurchargePct: '0.040000',
  ourVehicleFreightRate: '30.0000',
} as const;

export class InMemoryPricingConfigRepository implements PricingConfigRepository {
  #current: PricingConfig;

  readonly #changes: PricingConfigChange[] = [];

  constructor(seed?: Partial<PricingConfig>) {
    this.#current = {
      ...DEFAULT_PRICING_CONFIG,
      updatedAt: new Date(0).toISOString(),

      updatedBy: null,
      ...seed,
    };
  }

  async get(): Promise<PricingConfig> {
    return this.#current;
  }

  async update(
    patch: Partial<Omit<PricingConfig, 'updatedAt'>>,
    updatedAt: Date,
  ): Promise<PricingConfig> {
    const defined = Object.fromEntries(
      Object.entries(patch).filter(([, value]) => value !== undefined),
    );

    if (Object.keys(defined).length === 0) {
      return this.#current;
    }

    const previous = this.#current;
    this.#changes.push({
      at: updatedAt.toISOString(),
      actor: pricingConfigActor(defined['updatedBy']),
      poundsPerTonne: previous.poundsPerTonne,
      wastePct: previous.wastePct,
      coreCostPerCore: previous.coreCostPerCore,
      coreReferenceLengthIn: previous.coreReferenceLengthIn,
      plugCostPerPlug: previous.plugCostPerPlug,
      plugsPerRoll: previous.plugsPerRoll,
      palletCost: previous.palletCost,
      marginFloorPct: previous.marginFloorPct,
      overwrapSurchargePct: previous.overwrapSurchargePct,
      ourVehicleFreightRate: previous.ourVehicleFreightRate,
    });

    this.#current = {
      ...this.#current,
      ...defined,
      updatedAt: updatedAt.toISOString(),
    };
    return this.#current;
  }

  async history(limit: number): Promise<readonly PricingConfigChange[]> {
    return [...this.#changes].reverse().slice(0, limit);
  }
}
