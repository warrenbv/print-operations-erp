// Tests the pricing functions against synthetic examples with explicit expected figures:
// roll weight, pallets, tier selection, the tier multiplier and the line price.
import type { PricingConfig, PricingTier, RollCostBreakdown } from '@erp/types';
import { toDecimal } from '@erp/types';
import { describe, expect, it } from 'vitest';

import {
  addOnCostPerRoll,
  hardwareCostPerRoll,
  paperCostPerLb,
  paperCostPerRoll,
} from '../src/cost-build-up';
import { basePricePerRoll, priceQuoteLine } from '../src/quote-calculation';
import { palletsForQuantity, rollWeightLb } from '../src/roll-geometry';
import { selectTierByVolume, tierMultiplier } from '../src/tier-selection';

const config: PricingConfig = {
  poundsPerTonne: '2204.62262185',
  wastePct: '0.200000',
  coreCostPerCore: '2.0000',
  coreReferenceLengthIn: '48.0000',
  plugCostPerPlug: '0.05000000',
  plugsPerRoll: 2,
  palletCost: '10.0000',
  marginFloorPct: '0.120000',
  overwrapSurchargePct: '0.040000',
  ourVehicleFreightRate: '30.0000',
  updatedAt: '2026-01-01T00:00:00.000Z',
  updatedBy: null,
};

const cost: RollCostBreakdown = {
  rollWeightLb: '12.0000',
  paperCostPerLb: '1.0000',
  paperCostPerRoll: '15.0000',
  hardwareCostPerRoll: '0.8000',
  addOnCostPerRoll: '0.0000',
  totalCostPerRoll: '15.8000',
  rollsPerPallet: 50,
  feetPerRoll: '1200.0000',
};

function tier(code: string, minPallets: number, marginPct: string): PricingTier {
  return {
    id: `synthetic-${code}`,
    code,
    name: `Demo ${code}`,
    minPallets,
    marginPct,
    isListTier: false,
    updatedBy: null,
    createdAt: config.updatedAt,
    updatedAt: config.updatedAt,
  };
}

describe('independent synthetic pricing examples', () => {
  it('computes a 12-pound roll from explicit geometric inputs', () => {
    expect(
      rollWeightLb({
        basisWeightLb: '30',
        rollWidthIn: 12,
        feetPerRoll: '1200',
        reamAreaDivisor: '432',
      }).toString(),
    ).toBe('12');
  });

  it('rejects a zero area divisor', () => {
    expect(() =>
      rollWeightLb({
        basisWeightLb: '30',
        rollWidthIn: 12,
        feetPerRoll: '1200',
        reamAreaDivisor: '0',
      }),
    ).toThrow(RangeError);
  });

  it('uses the supplied mass conversion without rounding the intermediate', () => {
    expect(paperCostPerLb({ paperCostPerTonne: '2204.62262185' }, config).toString()).toBe('1');
    expect(() => paperCostPerLb({ paperCostPerTonne: '1000' }, { poundsPerTonne: '0' })).toThrow(
      RangeError,
    );
  });

  it('grosses up for waste instead of applying a markup', () => {
    expect(paperCostPerRoll(toDecimal('12'), toDecimal('1'), '0.2').toString()).toBe('15');
    expect(paperCostPerRoll(toDecimal('12'), toDecimal('1'), '0').toString()).toBe('12');
    expect(() => paperCostPerRoll(toDecimal('12'), toDecimal('1'), '1')).toThrow(RangeError);
  });

  it('allocates a quarter core, two plugs and one fiftieth of a pallet', () => {
    expect(hardwareCostPerRoll(config, 12, 50).toFixed(4)).toBe('0.8000');
    expect(hardwareCostPerRoll(config, 12, null).toFixed(4)).toBe('0.6000');
    expect(() => hardwareCostPerRoll(config, 12, 0)).toThrow(RangeError);
  });

  it('calculates per-ton additions from roll weight', () => {
    expect(addOnCostPerRoll(toDecimal('12'), '100', '50').toString()).toBe('0.9');
  });

  it('rounds partial pallets up and selects inclusive volume boundaries', () => {
    expect(palletsForQuantity(51, 50)).toBe(2);
    const tiers = [tier('standard', 0, '0.2'), tier('volume', 5, '0.1')];
    expect(selectTierByVolume(tiers, 4)?.code).toBe('standard');
    expect(selectTierByVolume([...tiers].reverse(), 5)?.code).toBe('volume');
    expect(() => tierMultiplier({ marginPct: '1' })).toThrow(RangeError);
  });

  it('prices ten rolls at twenty percent margin with independently derived totals', () => {
    expect(basePricePerRoll(toDecimal('15.8'), { marginPct: '0.2' }).toString()).toBe('19.75');
    const result = priceQuoteLine({
      cost,
      tier: { tier: tier('standard', 0, '0.2'), source: 'auto' },
      config,
      pallets: 1,
      quantityRolls: 10,
      overwrap: false,
      freight: { mode: 'pickup' },
    });
    expect(result).toMatchObject({
      pricePerRoll: '19.7500',
      extendedPrice: '197.5000',
      extendedCost: '158.0000',
      extendedMargin: '39.5000',
      floor: { status: 'ok' },
    });
  });

  it('keeps a below-floor hand price below floor even with profitable freight', () => {
    const result = priceQuoteLine({
      cost,
      tier: { tier: tier('standard', 0, '0.2'), source: 'auto' },
      config,
      pallets: 1,
      quantityRolls: 10,
      overwrap: false,
      overridePricePerRoll: '16',
      freight: { mode: 'carrier', carrierBid: '100', freightMarginPct: '0.5' },
    });
    expect(result.floor.status).toBe('below_floor');
    expect(result.pricePerRoll).toBe('16.0000');
  });
});
