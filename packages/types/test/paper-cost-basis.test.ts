// Tests for the paper cost figures an order line keeps.
import { describe, expect, it } from 'vitest';

import {
  paperCostBasisOf,
  paperCostBasisSchema,
  rollCostBreakdownSchema,
  type PaperCostBasis,
} from '../src/index';

const KRAFT: PaperCostBasis = {
  rollWeightLb: '10.0000',
  feetPerRoll: '1000.0000',
  paperCostPerLb: '0.4180',

  paperCostPerRoll: '4.3092',
};

describe('paperCostBasisOf', () => {
  it('reads a complete basis off a line', () => {
    expect(paperCostBasisOf(KRAFT)).toEqual(KRAFT);
  });

  it('returns undefined for a line with no stored basis', () => {
    expect(paperCostBasisOf({})).toBeUndefined();
  });

  it('refuses a partial basis rather than costing from three of four figures', () => {
    for (const missing of [
      'rollWeightLb',
      'feetPerRoll',
      'paperCostPerLb',
      'paperCostPerRoll',
    ] as const) {
      const partial: Record<string, string> = { ...KRAFT };
      delete partial[missing];

      expect(paperCostBasisOf(partial), `missing ${missing}`).toBeUndefined();
    }
  });
});

describe('paperCostPerLb scale', () => {
  const eightPlaces = { ...KRAFT, paperCostPerLb: '0.45360000' };

  it('accepts the eight places Postgres returns', () => {
    expect(paperCostBasisSchema.safeParse(eightPlaces).success).toBe(true);
  });

  it('accepts a $/lb that uses all eight', () => {
    expect(paperCostBasisSchema.safeParse({ ...KRAFT, paperCostPerLb: '0.67294031' }).success).toBe(
      true,
    );
  });

  it('still refuses a ninth place', () => {
    expect(
      paperCostBasisSchema.safeParse({ ...KRAFT, paperCostPerLb: '0.736291584' }).success,
    ).toBe(false);
  });

  it('takes the same scale on the cost build-up the quote line stores', () => {
    const breakdown = {
      rollWeightLb: '18.7250',
      paperCostPerLb: '0.46266422',
      paperCostPerRoll: '8.6634',
      hardwareCostPerRoll: '1.8865',
      addOnCostPerRoll: '0.0000',
      totalCostPerRoll: '10.5499',
      rollsPerPallet: 50,
      feetPerRoll: '1000.0000',
    };

    expect(rollCostBreakdownSchema.safeParse(breakdown).success).toBe(true);
    expect(
      rollCostBreakdownSchema.safeParse({ ...breakdown, paperCostPerRoll: '8.66340000' }).success,
    ).toBe(false);
  });
});
