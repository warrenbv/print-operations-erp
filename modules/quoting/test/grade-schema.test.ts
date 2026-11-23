// Tests the shared request schemas for grades and pricing configuration in packages/types: decimal
// scales, product families, and the refusal of non-positive figures.
import {
  createGradeRequestSchema,
  gradeFootageRequestSchema,
  gradeSchema,
  measureSchema,
  moneySchema,
  poundsPerTonneSchema,
  pricingConfigSchema,
  productFamilySchema,
  rateSchema,
  updateGradeRequestSchema,
} from '@erp/types';
import { describe, expect, it } from 'vitest';

describe('decimal string schemas', () => {
  it('rejects a JS number outright — floats are banned at this boundary', () => {
    expect(() => moneySchema.parse(760)).toThrow();
    expect(() => measureSchema.parse(1850)).toThrow();
  });

  it('accepts values at the scale each column stores', () => {
    expect(measureSchema.parse('1500.0000')).toBe('1500.0000');
    expect(measureSchema.parse('1750')).toBe('1750');
    expect(poundsPerTonneSchema.parse('2204.62262185')).toBe('2204.62262185');
    expect(measureSchema.parse('41.3')).toBe('41.3');
    expect(moneySchema.parse('1940.0000')).toBe('1940.0000');
    expect(rateSchema.parse('0.020000')).toBe('0.020000');
  });

  it('enforces each shape max scale', () => {
    expect(() => moneySchema.parse('2.50003')).toThrow();
    expect(() => measureSchema.parse('2.50003')).toThrow();
    expect(() => rateSchema.parse('0.4081526')).toThrow();
    expect(() => poundsPerTonneSchema.parse('3.580264917')).toThrow();
  });

  it('rejects things that look numeric but are not', () => {
    for (const bad of ['', ' ', 'abc', '1.2.3', '1e5', '$760', '760-', '--5']) {
      expect(() => moneySchema.parse(bad)).toThrow();
    }
  });
});

describe('productFamilySchema', () => {
  it('accepts the four product families', () => {
    for (const f of ['kraft', 'butcher', 'newsprint', 'digital_bond']) {
      expect(productFamilySchema.parse(f)).toBe(f);
    }
  });

  it('rejects an unknown family rather than creating a fifth by typo', () => {
    expect(() => productFamilySchema.parse('krafft')).toThrow();
    expect(() => productFamilySchema.parse('Kraft')).toThrow();
  });
});

describe('createGradeRequestSchema', () => {
  it('defaults footages to empty so a grade can be created before its variants are known', () => {
    const parsed = createGradeRequestSchema.parse({
      productFamily: 'butcher',
      code: '40#',
      basisWeightLb: '40',
      paperCostPerTonne: '1940',
    });
    expect(parsed.footages).toEqual([]);
  });

  it('carries footage variants through, trimming labels', () => {
    const parsed = createGradeRequestSchema.parse({
      productFamily: 'digital_bond',
      code: '20# Digital Bond',
      basisWeightLb: '20',
      paperCostPerTonne: '2400',

      footages: [
        { variant: '500', label: "  500' length  ", feetPerRoll: '500' },
        { variant: '275', label: "275' length", feetPerRoll: '275' },
      ],
    });
    expect(parsed.footages).toHaveLength(2);
    expect(parsed.footages[0]?.label).toBe("500' length");
  });

  it('has no paperCostPerLb — that figure is derived, never stored', () => {
    const parsed = createGradeRequestSchema.parse({
      productFamily: 'kraft',
      code: '30#',
      basisWeightLb: '30',
      paperCostPerTonne: '760',
      paperCostPerLb: '0.3447',
    });
    expect(parsed).not.toHaveProperty('paperCostPerLb');
  });

  it('has no waste — that is global config, not per grade', () => {
    const parsed = createGradeRequestSchema.parse({
      productFamily: 'kraft',
      code: '30#',
      basisWeightLb: '30',
      paperCostPerTonne: '760',
      wastePct: '0.02',
    });
    expect(parsed).not.toHaveProperty('wastePct');
  });

  it('defaults the ream divisor to the 24x36 ream', () => {
    const parsed = createGradeRequestSchema.parse({
      productFamily: 'kraft',
      code: '30#',
      basisWeightLb: '30',
      paperCostPerTonne: '760',
    });
    expect(parsed.reamAreaDivisor).toBe('432.0000');
  });

  it('takes 187 for a bond grade', () => {
    const parsed = createGradeRequestSchema.parse({
      productFamily: 'digital_bond',
      code: '20# Digital Bond',
      basisWeightLb: '20',
      reamAreaDivisor: '187.0000',
      paperCostPerTonne: '2400',
    });
    expect(parsed.reamAreaDivisor).toBe('187.0000');
  });
});

describe('grade write schemas reject non-positive figures', () => {
  const validCreate = {
    productFamily: 'kraft',
    code: '30#',
    basisWeightLb: '30',
    reamAreaDivisor: '432.0000',
    paperCostPerTonne: '760',
  } as const;

  const scalarFields = ['basisWeightLb', 'reamAreaDivisor', 'paperCostPerTonne'] as const;
  const nonPositive = ['0', '0.0000', '-0', '-34', '-0.0001'] as const;

  for (const field of scalarFields) {
    for (const bad of nonPositive) {
      it(`refuses ${field} of "${bad}" on create`, () => {
        expect(createGradeRequestSchema.safeParse({ ...validCreate, [field]: bad }).success).toBe(
          false,
        );
      });

      it(`refuses ${field} of "${bad}" on update`, () => {
        expect(updateGradeRequestSchema.safeParse({ [field]: bad }).success).toBe(false);
      });
    }

    it(`answers rather than throwing on a non-numeric ${field}`, () => {
      for (const bad of ['abc', '', '30 lb']) {
        const result = createGradeRequestSchema.safeParse({ ...validCreate, [field]: bad });

        expect(result.success, `${field}=${bad}`).toBe(false);
        expect(result.error?.issues.map((issue) => issue.path.join('.'))).toContain(field);
      }
    });

    it(`still accepts a positive ${field}`, () => {
      expect(createGradeRequestSchema.safeParse({ ...validCreate, [field]: '1' }).success).toBe(
        true,
      );
      expect(
        updateGradeRequestSchema.safeParse({ [field]: '0.0001', lockVersion: 1 }).success,
      ).toBe(true);
    });
  }

  it('refuses a patch that carries no lockVersion', () => {
    expect(updateGradeRequestSchema.safeParse({ paperCostPerTonne: '900' }).success).toBe(false);
    expect(
      updateGradeRequestSchema.safeParse({ paperCostPerTonne: '900', lockVersion: 3 }).success,
    ).toBe(true);
  });

  it('refuses a lockVersion below the first generation, or a fractional one', () => {
    expect(updateGradeRequestSchema.safeParse({ code: '30#', lockVersion: 0 }).success).toBe(false);
    expect(updateGradeRequestSchema.safeParse({ code: '30#', lockVersion: 3.7 }).success).toBe(
      false,
    );
  });

  for (const bad of nonPositive) {
    it(`refuses a footage variant at "${bad}" feet per roll`, () => {
      const footage = { variant: 'long', label: 'Long roll', feetPerRoll: bad };
      expect(gradeFootageRequestSchema.safeParse(footage).success).toBe(false);
      expect(
        createGradeRequestSchema.safeParse({ ...validCreate, footages: [footage] }).success,
      ).toBe(false);
      expect(updateGradeRequestSchema.safeParse({ footages: [footage] }).success).toBe(false);
    });
  }

  it('names the field in words the Billing Manager can act on', () => {
    const result = createGradeRequestSchema.safeParse({ ...validCreate, reamAreaDivisor: '0' });
    expect(result.success).toBe(false);

    expect(result.error?.issues[0]?.message).toBe('ream area divisor must be greater than zero');
    expect(result.error?.issues[0]?.path).toEqual(['reamAreaDivisor']);
  });

  it('still defaults the ream divisor when the field is simply absent', () => {
    const parsed = createGradeRequestSchema.parse({
      productFamily: 'kraft',
      code: '30#',
      basisWeightLb: '30',
      paperCostPerTonne: '760',
    });
    expect(parsed.reamAreaDivisor).toBe('432.0000');
  });

  it('leaves the ENTITY schema loose, so an already-bad row stays readable', () => {
    const stored = {
      id: 'g-1',
      productFamily: 'kraft',
      code: '30#',
      basisWeightLb: '-30',
      reamAreaDivisor: '0',
      paperCostPerTonne: '0',
      footages: [{ variant: 'long', label: 'Long roll', feetPerRoll: '0' }],
      createdAt: '2026-08-05T09:00:00.000Z',
      updatedAt: '2026-08-05T09:00:00.000Z',
    };
    expect(gradeSchema.parse(stored).reamAreaDivisor).toBe('0');
  });
});

describe('pricingConfigSchema', () => {
  const fullPrecisionConstants = {
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
    updatedAt: '2026-08-05T09:00:00.000Z',

    updatedBy: null,
  };

  it('accepts the constants at full precision', () => {
    const parsed = pricingConfigSchema.parse(fullPrecisionConstants);
    expect(parsed.poundsPerTonne).toBe('2204.62262185');
  });

  it('keeps the landed plug price finer than a cent', () => {
    const parsed = pricingConfigSchema.parse(fullPrecisionConstants);
    expect(parsed.plugCostPerPlug).toBe('0.05000000');
    expect(() => moneySchema.parse('0.0532109')).toThrow();
  });

  it('requires the hardware costs the cost build-up consumes', () => {
    const withoutHardware: Record<string, unknown> = { ...fullPrecisionConstants };
    delete withoutHardware.coreCostPerCore;

    expect(() => pricingConfigSchema.parse(withoutHardware)).toThrow();
  });
});
