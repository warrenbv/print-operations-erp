// The pricing configuration: the pounds-per-tonne conversion, waste, hardware costs, the margin
// floor, the overwrap surcharge and the own-vehicle freight rate. The Billing Manager owns it:
// docs/product/roles.md. Changing the floor is one of the two remedies for a line below it:
// docs/product/requirements.md (R6).
import type { PricingConfig, PricingConfigChange, UpdatePricingConfigRequest } from '@erp/types';

import type { Clock, PricingConfigRepository } from '../ports';

const PRICING_CONFIG_HISTORY_LIMIT = 50;

export interface PricingConfigServiceOptions {
  config: PricingConfigRepository;
  clock: Clock;
}

export class PricingConfigService {
  readonly #config: PricingConfigRepository;
  readonly #clock: Clock;

  constructor(options: PricingConfigServiceOptions) {
    this.#config = options.config;
    this.#clock = options.clock;
  }

  async get(): Promise<PricingConfig> {
    return this.#config.get();
  }

  async history(limit = PRICING_CONFIG_HISTORY_LIMIT): Promise<readonly PricingConfigChange[]> {
    return this.#config.history(limit);
  }

  async update(patch: UpdatePricingConfigRequest, updatedBy: string): Promise<PricingConfig> {
    // Each field is copied by name, so a field the request schema accepts but this list omits is
    // never written. modules/quoting/test/pricing-config-service.test.ts checks the list is
    // complete.
    return this.#config.update(
      {
        ...(patch.poundsPerTonne === undefined ? {} : { poundsPerTonne: patch.poundsPerTonne }),
        ...(patch.wastePct === undefined ? {} : { wastePct: patch.wastePct }),
        ...(patch.coreCostPerCore === undefined ? {} : { coreCostPerCore: patch.coreCostPerCore }),
        ...(patch.coreReferenceLengthIn === undefined
          ? {}
          : { coreReferenceLengthIn: patch.coreReferenceLengthIn }),
        ...(patch.plugCostPerPlug === undefined ? {} : { plugCostPerPlug: patch.plugCostPerPlug }),
        ...(patch.plugsPerRoll === undefined ? {} : { plugsPerRoll: patch.plugsPerRoll }),
        ...(patch.palletCost === undefined ? {} : { palletCost: patch.palletCost }),
        ...(patch.marginFloorPct === undefined ? {} : { marginFloorPct: patch.marginFloorPct }),
        ...(patch.overwrapSurchargePct === undefined
          ? {}
          : { overwrapSurchargePct: patch.overwrapSurchargePct }),
        ...(patch.ourVehicleFreightRate === undefined
          ? {}
          : { ourVehicleFreightRate: patch.ourVehicleFreightRate }),
        updatedBy,
      },
      this.#clock.now(),
    );
  }
}
