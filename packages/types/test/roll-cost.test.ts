// Tests for the converting and print costs per ton: refused when negative or beyond their column, wherever a line takes them.
import { describe, expect, it } from 'vitest';

import { quoteLineSchema, setQuoteLinesRequestSchema } from '../src/quote';
import { rollCostRequestSchema, type RollCostRequest } from '../src/roll-cost';

const request: RollCostRequest = { gradeId: 'g1', footageVariant: 'long', rollWidthIn: 24 };

const OVER_MONEY = '1000000000000000';

const COSTS = [
  { field: 'convertCostPerTon', words: 'converting cost per US ton' },
  { field: 'printCostPerTon', words: 'print cost per US ton' },
] as const;

describe.each(COSTS)('rollCostRequestSchema.$field', ({ field, words }) => {
  it('refuses a negative cost, in the glossary words, on its own field', () => {
    for (const value of ['-5', '-0.0001', '-200.0000']) {
      const parsed = rollCostRequestSchema.safeParse({ ...request, [field]: value });

      expect(parsed.success, value).toBe(false);
      expect(parsed.error?.issues).toEqual([
        expect.objectContaining({ path: [field], message: `${words} cannot be negative` }),
      ]);
    }
  });

  it('takes zero as the default', () => {
    for (const value of ['0', '0.0000', '-0']) {
      expect(rollCostRequestSchema.safeParse({ ...request, [field]: value }).success, value).toBe(
        true,
      );
    }
  });

  it('takes a positive cost as typed', () => {
    for (const value of ['200', '187.2500', '0.0001']) {
      const parsed = rollCostRequestSchema.safeParse({ ...request, [field]: value });

      expect(parsed.success, value).toBe(true);
      expect(parsed.data?.[field]).toBe(value);
    }
  });

  it('still refuses a figure wider than its column, naming the ceiling', () => {
    const parsed = rollCostRequestSchema.safeParse({ ...request, [field]: OVER_MONEY });

    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues).toEqual([
      expect.objectContaining({
        path: [field],
        message: `${words} cannot be more than 999,999,999,999,999.9999`,
      }),
    ]);
  });
});

describe('a negative cost per US ton beyond the roll-cost request', () => {
  const line = { ...request, quantityRolls: 10, taxTreatment: { taxStatus: 'non_tax' } };

  it('is refused on the quote line save, through both extensions of the request', () => {
    const refused = setQuoteLinesRequestSchema.safeParse({
      lines: [line, { ...line, convertCostPerTon: '-5', printCostPerTon: '-0.09' }],
      lockVersion: 1,
    });

    expect(refused.success).toBe(false);
    expect(refused.error?.issues).toEqual([
      expect.objectContaining({
        path: ['lines', 1, 'convertCostPerTon'],
        message: 'converting cost per US ton cannot be negative',
      }),
      expect.objectContaining({
        path: ['lines', 1, 'printCostPerTon'],
        message: 'print cost per US ton cannot be negative',
      }),
    ]);
    expect(
      setQuoteLinesRequestSchema.safeParse({
        lines: [{ ...line, convertCostPerTon: '200', printCostPerTon: '0' }],
        lockVersion: 1,
      }).success,
    ).toBe(true);
  });

  it('accepts a negative on a stored line, so such a row renders and can be corrected', () => {
    expect(quoteLineSchema.shape.convertCostPerTon.safeParse('-5').success).toBe(true);
    expect(quoteLineSchema.shape.printCostPerTon.safeParse('-5').success).toBe(true);
  });
});
