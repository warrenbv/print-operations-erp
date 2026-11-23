// Tests the pricing configuration service, and that every field the request schema accepts is
// written. Subject: modules/quoting/src/services/pricing-config-service.ts.
import { updatePricingConfigRequestSchema, type UpdatePricingConfigRequest } from '@erp/types';
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_PRICING_CONFIG,
  InMemoryPricingConfigRepository,
} from '../src/adapters/in-memory/in-memory-pricing-config-repository';
import { PricingConfigService } from '../src/services/pricing-config-service';
import { MutableClock } from './fixtures';

function newService(): { service: PricingConfigService; clock: MutableClock } {
  const clock = new MutableClock();
  const service = new PricingConfigService({
    config: new InMemoryPricingConfigRepository(),
    clock,
  });
  return { service, clock };
}

describe('PricingConfigService', () => {
  it('starts from the seeded configuration', async () => {
    const { service } = newService();
    const config = await service.get();
    expect(config.poundsPerTonne).toBe('2204.62262185');
    expect(config.wastePct).toBe('0.020000');
  });

  it('keeps the configured unit conversion at full precision', async () => {
    const { service } = newService();
    const config = await service.get();

    expect(config.poundsPerTonne).toBe(DEFAULT_PRICING_CONFIG.poundsPerTonne);
    expect(config.poundsPerTonne.split('.')[1]).toHaveLength(8);
  });

  it('patches one constant without disturbing the others', async () => {
    const { service, clock } = newService();
    clock.advance(60_000);
    const updated = await service.update({ wastePct: '0.033000' }, 'dev-billing');
    expect(updated.wastePct).toBe('0.033000');
    expect(updated.poundsPerTonne).toBe('2204.62262185');
    expect(updated.updatedAt).toBe(clock.now().toISOString());
  });

  it('is a no-op on an empty patch', async () => {
    const { service } = newService();
    const before = await service.get();
    const after = await service.update({}, 'dev-billing');
    expect(after.poundsPerTonne).toBe(before.poundsPerTonne);
    expect(after.wastePct).toBe(before.wastePct);
  });
});

describe('every field the request schema accepts is actually written', () => {
  const SAMPLES: Required<UpdatePricingConfigRequest> = {
    poundsPerTonne: '2196.40000000',
    wastePct: '0.045000',
    coreCostPerCore: '2.8600',
    coreReferenceLengthIn: '60.0000',
    plugCostPerPlug: '0.07391542',
    plugsPerRoll: 4,
    palletCost: '11.2500',
    marginFloorPct: '0.158000',
    overwrapSurchargePct: '0.073000',
    ourVehicleFreightRate: '34.5000',
  };

  it('covers the whole schema — this list cannot silently fall behind', () => {
    expect(Object.keys(SAMPLES).sort()).toEqual(
      Object.keys(updatePricingConfigRequestSchema.shape).sort(),
    );
  });

  it.each(Object.entries(SAMPLES))('persists %s', async (field, value) => {
    const { service } = newService();
    const updated = await service.update({ [field]: value }, 'dev-billing');
    expect(updated[field as keyof typeof SAMPLES]).toBe(value);
    expect((await service.get())[field as keyof typeof SAMPLES]).toBe(value);
  });

  it('persists all ten at once', async () => {
    const { service } = newService();
    const updated = await service.update(SAMPLES, 'dev-billing');
    expect(updated).toMatchObject(SAMPLES);
  });
});
