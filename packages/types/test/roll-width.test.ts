// Tests for roll widths in sixteenths, whole custom widths and how a width is written.
import { describe, expect, it } from 'vitest';

import {
  CUSTOM_WIDTH_REFUSAL,
  ROLL_WIDTH_REFUSAL,
  formatWidthIn,
  gradeWidthSchema,
  orderLineSchema,
  palletFitSchema,
  quoteLineInputSchema,
  quoteLineSchema,
  rollCode,
  rollCostRequestSchema,
  rollWidthSchema,
} from '../src';

describe('rollWidthSchema', () => {
  it('takes whole inches and sixteenths from 1 to 1000', () => {
    for (const width of [1, 12, 24, 1000, 11.3125, 9.75, 4.625, 1.0625, 999.9375]) {
      expect(rollWidthSchema.parse(width)).toBe(width);
    }
  });

  it('refuses anything else with one sentence', () => {
    for (const width of [13.3, 7.3, 0.75, 0, -12, 1000.0625, 1001]) {
      const parsed = rollWidthSchema.safeParse(width);
      expect(parsed.success, String(width)).toBe(false);
      expect(parsed.error?.issues[0]?.message).toBe(ROLL_WIDTH_REFUSAL);
    }

    expect(rollWidthSchema.safeParse(Number.NaN).success).toBe(false);
    expect(ROLL_WIDTH_REFUSAL).toBe(
      'a width is whole inches or sixteenths of an inch, from 1 to 1000 (11 5/16 is 11.3125)',
    );
  });

  it('is the rule on every schema that carries a width', () => {
    expect(gradeWidthSchema.safeParse({ rollWidthIn: 11.3125 }).success).toBe(true);
    expect(gradeWidthSchema.safeParse({ rollWidthIn: 13.3 }).success).toBe(false);
    const request = { gradeId: 'g1', footageVariant: '500' };
    expect(rollCostRequestSchema.safeParse({ ...request, rollWidthIn: 9.75 }).success).toBe(true);
    expect(rollCostRequestSchema.safeParse({ ...request, rollWidthIn: 8.7 }).success).toBe(false);
    const fit = { id: 'f1', productFamily: 'digital_bond', rollsPerPallet: 50 };
    const at = { updatedAt: '2026-10-30T00:00:00.000Z' };
    expect(palletFitSchema.safeParse({ ...fit, ...at, rollWidthIn: 4.625 }).success).toBe(true);
    expect(palletFitSchema.safeParse({ ...fit, ...at, rollWidthIn: 6.2 }).success).toBe(false);
    expect(quoteLineSchema.shape.rollWidthIn).toBe(rollWidthSchema);
    expect(orderLineSchema.shape.rollWidthIn).toBe(rollWidthSchema);
  });
});

describe('a custom width stays whole', () => {
  const line = {
    gradeId: 'g1',
    footageVariant: '500',
    quantityRolls: 10,
    taxTreatment: { taxStatus: 'non_tax' },
  };

  it('takes a stock width in sixteenths and a whole custom width', () => {
    expect(quoteLineInputSchema.safeParse({ ...line, rollWidthIn: 11.3125 }).success).toBe(true);
    expect(
      quoteLineInputSchema.safeParse({ ...line, rollWidthIn: 17, customWidth: true }).success,
    ).toBe(true);
  });

  it('refuses a custom width in sixteenths with the quote form words', () => {
    const parsed = quoteLineInputSchema.safeParse({
      ...line,
      rollWidthIn: 11.3125,
      customWidth: true,
    });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues).toEqual([
      expect.objectContaining({ path: ['rollWidthIn'], message: CUSTOM_WIDTH_REFUSAL }),
    ]);
    expect(CUSTOM_WIDTH_REFUSAL).toBe('a custom width is a whole number of inches from 1 to 1000.');
  });
});

describe('formatWidthIn', () => {
  it('prints a whole width with no decimal places', () => {
    expect(formatWidthIn(12)).toBe('12"');
    expect(formatWidthIn(24)).toBe('24"');
    expect(formatWidthIn(1000)).toBe('1000"');
    expect(formatWidthIn(24, 'in')).toBe('24in');
    expect(formatWidthIn(24, ' in')).toBe('24 in');
  });

  it('prints sixteenths as a reduced mixed fraction', () => {
    expect(formatWidthIn(11.3125)).toBe('11 5/16"');
    expect(formatWidthIn(9.75)).toBe('9 3/4"');
    expect(formatWidthIn(4.625)).toBe('4 5/8"');
    expect(formatWidthIn(23.5)).toBe('23 1/2"');
    expect(formatWidthIn(1.0625)).toBe('1 1/16"');
    expect(formatWidthIn(11.3125, 'in')).toBe('11 5/16in');
    expect(formatWidthIn(11.3125, ' in')).toBe('11 5/16 in');
  });

  it('prints a figure that is not a width as its decimal rather than rounding it', () => {
    expect(formatWidthIn(13.3)).toBe('13.3"');
  });
});

describe('the roll code carries a fractional width as its decimal', () => {
  it('reads DP/11.3125x1480/K49 for a Kraft roll at 11 5/16"', () => {
    const paper = { productFamily: 'kraft', code: '49#', basisWeightLb: '49.0000' } as const;
    expect(rollCode(paper, { rollWidthIn: 11.3125, feetPerRoll: '1480.0000' })).toBe(
      'DP/11.3125x1480/K49',
    );
    expect(rollCode(paper, { rollWidthIn: 24, feetPerRoll: '1250.0000' })).toBe('DP/24x1250/K49');
  });

  it('prints no code for Digital Bond, which has no letter', () => {
    const paper = { productFamily: 'digital_bond', code: '32#', basisWeightLb: '32.0000' } as const;
    expect(rollCode(paper, { rollWidthIn: 9.75, feetPerRoll: '1260.0000' })).toBeUndefined();
  });
});
