// Tests tier selection by pallet count, the tier multiplier and a forced tier.
// Subject: modules/quoting/src/tier-selection.ts.
import type { PricingTier } from '@erp/types';
import { describe, expect, it } from 'vitest';

import { DEFAULT_PRICING_TIERS } from '../src/adapters/in-memory/in-memory-pricing-tier-repository';
import { NoTierForVolumeError, UnknownTierCodeError } from '../src/ports';
import { resolveTier, selectTierByVolume, tierMultiplier } from '../src/tier-selection';

const EPOCH = new Date(0).toISOString();
const TIERS: readonly PricingTier[] = DEFAULT_PRICING_TIERS.map((t) => ({
  ...t,
  createdAt: EPOCH,
  updatedAt: EPOCH,
}));

describe('selectTierByVolume', () => {
  it('picks the highest threshold at or below the pallet count', () => {
    const cases: [number, string][] = [
      [0, 'retail'],
      [1, 'small_batch'],
      [4, 'small_batch'],
      [5, 'volume_1'],
      [9, 'volume_1'],
      [10, 'list'],
      [14, 'list'],
      [15, 'volume_3'],
      [19, 'volume_3'],
      [20, 'volume_4'],
      [29, 'volume_4'],
      [30, 'volume_5'],
      [1000, 'volume_5'],
    ];
    for (const [pallets, expected] of cases) {
      expect(selectTierByVolume(TIERS, pallets)?.code, `${pallets} pallets`).toBe(expected);
    }
  });

  it('is inclusive at the threshold itself, not exclusive', () => {
    expect(selectTierByVolume(TIERS, 10)?.code).toBe('list');
    expect(selectTierByVolume(TIERS, 9)?.code).toBe('volume_1');
  });

  it('does not depend on the order it is given', () => {
    const shuffled = [...TIERS].reverse();
    expect(selectTierByVolume(shuffled, 15)?.code).toBe('volume_3');
  });

  it('returns null when every threshold is above the volume', () => {
    const noZero = TIERS.filter((t) => t.minPallets > 0);
    expect(selectTierByVolume(noZero, 0)).toBeNull();
  });

  it('returns null for an empty table', () => {
    expect(selectTierByVolume([], 5)).toBeNull();
  });
});

describe('tierMultiplier', () => {
  it('computes 1/(1 - margin) from illustrative independent inputs', () => {
    expect(tierMultiplier({ marginPct: '0.200000' }).toFixed(6)).toBe('1.250000');
    expect(tierMultiplier({ marginPct: '0.250000' }).toFixed(6)).toBe('1.333333');
    expect(tierMultiplier({ marginPct: '0.500000' }).toFixed(6)).toBe('2.000000');
  });

  it('keeps the repeating decimal unrounded, which is why it is not stored', () => {
    const m = tierMultiplier({ marginPct: '0.410000' });
    expect(m.toFixed(16)).toBe('1.6949152542372881');
  });

  it('returns cost price at zero margin', () => {
    expect(tierMultiplier({ marginPct: '0.000000' }).toFixed(4)).toBe('1.0000');
  });

  it('refuses a margin of 1 or more rather than returning Infinity', () => {
    expect(() => tierMultiplier({ marginPct: '1.000000' })).toThrow(RangeError);
    expect(() => tierMultiplier({ marginPct: '1.750000' })).toThrow(RangeError);
  });

  it('round-trips a realistic cost through a tier', () => {
    const cost = '80.0000';
    const price = tierMultiplier({ marginPct: '0.200000' }).times(cost);
    expect(price.toFixed(4)).toBe('100.0000');
  });
});

describe('resolveTier', () => {
  it('auto-selects by volume and says so', () => {
    const result = resolveTier(TIERS, 15);
    expect(result.tier.code).toBe('volume_3');
    expect(result.source).toBe('auto');
  });

  it('honours an override regardless of volume, and says so', () => {
    const result = resolveTier(TIERS, 40, 'retail');
    expect(result.tier.code).toBe('retail');
    expect(result.source).toBe('override');
  });

  it('records the source so a hand-picked price is distinguishable at review', () => {
    expect(resolveTier(TIERS, 26).source).toBe('auto');
    expect(resolveTier(TIERS, 26, 'volume_5').source).toBe('override');
  });

  it('rejects an unknown override code instead of falling back to auto', () => {
    expect(() => resolveTier(TIERS, 10, 'platinum')).toThrow(UnknownTierCodeError);
  });

  it('throws when no tier applies rather than pricing against nothing', () => {
    const noZero = TIERS.filter((t) => t.minPallets > 0);
    expect(() => resolveTier(noZero, 0)).toThrow(NoTierForVolumeError);
  });
});
