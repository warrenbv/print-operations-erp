// Every write shape that reaches a numeric column refuses a figure the column cannot hold.
// The ceilings derive from `DECIMAL_SCALES` and `DECIMAL_PRECISION` in packages/types/src/decimal.ts. A failure means a
// request could reach the database with a figure that overflows its column instead of being refused with a message.
import { describe, expect, it } from 'vitest';

import {
  DECIMAL_PRECISION,
  DECIMAL_SCALES,
  columnCeiling,
  measureSchema,
  moneySchema,
  withinColumn,
} from '../src/decimal';
import { createGradeRequestSchema, updatePricingConfigRequestSchema } from '../src/grade';
import { capturePurchaseOrderRequestSchema } from '../src/order';
import { rollCostRequestSchema } from '../src/roll-cost';

describe('columnCeiling', () => {
  it('is the largest value the kind holds, from the two numbers that define it', () => {
    expect(columnCeiling('measure')).toBe('99999999.9999');
    expect(columnCeiling('money')).toBe('999999999999999.9999');
    expect(columnCeiling('rate')).toBe('999.999999');
    expect(columnCeiling('unitCost')).toBe('9999.99999999');
    expect(columnCeiling('poundsPerTonne')).toBe('9999.99999999');
  });

  it('is derived, so a scale or precision change moves the bound with it', () => {
    for (const kind of Object.keys(DECIMAL_SCALES) as (keyof typeof DECIMAL_SCALES)[]) {
      const ceiling = columnCeiling(kind);
      const [whole = '', fraction = ''] = ceiling.split('.');
      expect(fraction.length, kind).toBe(DECIMAL_SCALES[kind]);
      expect(whole.length + fraction.length, kind).toBe(DECIMAL_PRECISION[kind]);
      expect(ceiling.replace('.', ''), kind).toMatch(/^9+$/);
    }
  });
});

describe('withinColumn', () => {
  const bounded = withinColumn(measureSchema, 'measure', 'footage');

  it('accepts the ceiling exactly and refuses the next figure up', () => {
    expect(bounded.safeParse('99999999.9999').success).toBe(true);
    expect(bounded.safeParse('100000000').success).toBe(false);
  });

  it('names the figure a person has to get under, grouped for reading', () => {
    const result = bounded.safeParse('100000000');

    expect(result.error?.issues[0]?.message).toBe('footage cannot be more than 99,999,999.9999');
  });

  it('leaves the shape check to fail first, rather than throwing on a letter', () => {
    const result = withinColumn(moneySchema, 'money', 'an amount').safeParse('abc');

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toContain('expected a decimal');
  });
});

describe('the write shapes that reach a numeric column', () => {
  const OVER_MEASURE = '100000000';
  const OVER_MONEY = '1000000000000000';
  const OVER_UNIT_COST = '10000';

  it('refuses a grade figure wider than its column', () => {
    const grade = {
      productFamily: 'kraft',
      code: '37#',
      basisWeightLb: OVER_MEASURE,
      paperCostPerTonne: '1162.0000',
      footages: [],
    };

    expect(createGradeRequestSchema.safeParse(grade).success).toBe(false);
    expect(createGradeRequestSchema.safeParse({ ...grade, basisWeightLb: '37.0000' }).success).toBe(
      true,
    );
  });

  it('refuses a pricing constant wider than its column, at three different scales', () => {
    expect(updatePricingConfigRequestSchema.safeParse({ palletCost: OVER_MONEY }).success).toBe(
      false,
    );
    expect(
      updatePricingConfigRequestSchema.safeParse({ plugCostPerPlug: OVER_UNIT_COST }).success,
    ).toBe(false);
    expect(
      updatePricingConfigRequestSchema.safeParse({ poundsPerTonne: OVER_UNIT_COST }).success,
    ).toBe(false);

    expect(
      updatePricingConfigRequestSchema.safeParse({
        palletCost: '17.2500',
        plugCostPerPlug: '0.05000000',
        poundsPerTonne: '2204.62262185',
      }).success,
    ).toBe(true);
  });

  it('refuses a roll-cost override wider than its column', () => {
    const request = { gradeId: 'g1', footageVariant: 'long', rollWidthIn: 24 };

    expect(
      rollCostRequestSchema.safeParse({ ...request, convertCostPerTon: OVER_MONEY }).success,
    ).toBe(false);
    expect(
      rollCostRequestSchema.safeParse({ ...request, feetPerRollOverride: OVER_MEASURE }).success,
    ).toBe(false);
    expect(rollCostRequestSchema.safeParse(request).success).toBe(true);
  });

  it('takes a PO number or none, bounded at 64 characters', () => {
    const capture = { lockVersion: 1, capturedBy: 'dev-sales' };

    expect(capturePurchaseOrderRequestSchema.safeParse(capture).success).toBe(true);
    expect(
      capturePurchaseOrderRequestSchema.safeParse({ ...capture, poNumber: 'approved by customer' })
        .success,
    ).toBe(true);
    expect(
      capturePurchaseOrderRequestSchema.safeParse({ ...capture, poNumber: 'x'.repeat(65) }).success,
    ).toBe(false);
  });
});
