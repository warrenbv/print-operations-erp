// Tests for the bounds on the pricing constants, the rates the build-up divides by among them.
import { describe, expect, it } from 'vitest';

import { pricingConfigValuesSchema, updatePricingConfigRequestSchema } from '../src/grade';

const VALUES = {
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
};

describe('the rates the build-up divides by — waste and the margin floor', () => {
  for (const field of ['wastePct', 'marginFloorPct'] as const) {
    it(`${field} takes a ratio inside [0, 1)`, () => {
      expect(pricingConfigValuesSchema.safeParse({ ...VALUES, [field]: '0.000000' }).success).toBe(
        true,
      );
      expect(pricingConfigValuesSchema.safeParse({ ...VALUES, [field]: '0.999999' }).success).toBe(
        true,
      );
    });

    it(`${field} refuses 1, which the column also refuses`, () => {
      expect(pricingConfigValuesSchema.safeParse({ ...VALUES, [field]: '1.000000' }).success).toBe(
        false,
      );
    });

    it(`${field} refuses a percent typed as a ratio — the defect this closes`, () => {
      const parsed = updatePricingConfigRequestSchema.safeParse({ [field]: '15' });
      expect(parsed.success).toBe(false);
      expect(parsed.error?.issues[0]?.message).toMatch(/at least 0 and less than 1/);
    });

    it(`${field} refuses a negative`, () => {
      expect(pricingConfigValuesSchema.safeParse({ ...VALUES, [field]: '-0.040000' }).success).toBe(
        false,
      );
    });
  }
});

describe('the overwrap surcharge', () => {
  it('takes a ratio at or above 1', () => {
    expect(
      pricingConfigValuesSchema.safeParse({ ...VALUES, overwrapSurchargePct: '3.400000' }).success,
    ).toBe(true);
  });

  it('refuses a negative', () => {
    expect(
      pricingConfigValuesSchema.safeParse({ ...VALUES, overwrapSurchargePct: '-0.040000' }).success,
    ).toBe(false);
  });

  it('refuses a value wider than the column, and says that is why', () => {
    expect(
      pricingConfigValuesSchema.safeParse({ ...VALUES, overwrapSurchargePct: '999.999999' })
        .success,
    ).toBe(true);

    const parsed = updatePricingConfigRequestSchema.safeParse({
      overwrapSurchargePct: '1000.000000',
    });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.message).toMatch(
      /less than 1000 — the column holds three digits before the decimal point/,
    );
  });
});

describe('the shape check is still there underneath', () => {
  it('refuses a seventh decimal place, which the numeric(9,6) column cannot hold', () => {
    expect(
      pricingConfigValuesSchema.safeParse({ ...VALUES, marginFloorPct: '0.1200001' }).success,
    ).toBe(false);
  });

  it('refuses a JS number', () => {
    expect(pricingConfigValuesSchema.safeParse({ ...VALUES, marginFloorPct: 0.12 }).success).toBe(
      false,
    );
  });
});
