// Tests for the decimal schemas, parsing and serialising, constructor isolation and display formatting:
// docs/decisions/003-decimal-arithmetic.md.
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  DECIMAL_SCALES,
  formatEstimatedPounds,
  formatMeasure,
  formatMoney,
  formatPricePerPound,
  formatRatePercent,
  fromDecimal,
  measureSchema,
  moneySchema,
  poundsPerTonneSchema,
  rateSchema,
  positiveDecimal,
  roundToCents,
  sum,
  toDecimal,
  toMoney,
  toRate,
  unitCostSchema,
  zero,
} from '../src/decimal';

describe('wire schemas', () => {
  it('reject a JS number rather than coercing it', () => {
    expect(() => moneySchema.parse(760.1)).toThrow();
    expect(() => rateSchema.parse(0.37)).toThrow();
  });

  it('accept values at the scale each column stores', () => {
    expect(moneySchema.parse('1940.0000')).toBe('1940.0000');
    expect(measureSchema.parse('1320')).toBe('1320');
    expect(rateSchema.parse('0.020000')).toBe('0.020000');
    expect(poundsPerTonneSchema.parse('2204.62262185')).toBe('2204.62262185');
  });

  it('enforce each scale', () => {
    expect(() => moneySchema.parse('6.20003')).toThrow();
    expect(() => rateSchema.parse('0.5820391')).toThrow();
    expect(() => poundsPerTonneSchema.parse('3.861402957')).toThrow();
  });

  it('reject notation that is numeric-looking but not a plain decimal', () => {
    for (const bad of ['', 'abc', '1.2.3', '1e5', '$760', 'Infinity', 'NaN']) {
      expect(() => moneySchema.parse(bad)).toThrow();
    }
  });
});

describe('toDecimal / fromDecimal', () => {
  it('survives the arithmetic that breaks floats', () => {
    expect(fromDecimal(toDecimal('0.9').plus(toDecimal('2.3')), 'money')).toBe('3.2000');
  });

  it('rejects a number at the parse boundary, at runtime not just in the types', () => {
    for (const bad of [0.8999999999999999, 760, null, undefined, {}]) {
      // @ts-expect-error -- intentional
      expect(() => toDecimal(bad)).toThrow(TypeError);
    }
  });

  it('rounds half-up, which is the rule per tax line', () => {
    expect(fromDecimal(toDecimal('0.48275'), 'money')).toBe('0.4828');
    expect(fromDecimal(toDecimal('5.5'), 'rate')).toBe('5.500000');

    expect(fromDecimal(toDecimal('0.317250'), 'rate')).toBe('0.317250');
  });

  it('rounds half-up away from zero for negatives too', () => {
    expect(fromDecimal(toDecimal('-0.48275'), 'money')).toBe('-0.4828');
  });

  it('serialises at the scale of the target column', () => {
    expect(toMoney(toDecimal('4'))).toBe('4.0000');
    expect(toRate(toDecimal('0.42'))).toBe('0.420000');
    expect(fromDecimal(toDecimal('2204.62262185'), 'poundsPerTonne')).toBe('2204.62262185');
  });

  it('keeps intermediate precision, rounding only on the way out', () => {
    const paper = toDecimal('760');
    const waste = toDecimal('0.09');
    const adjusted = paper.div(toDecimal('1').minus(waste));
    expect(adjusted.toFixed(10)).toBe('835.1648351648');
    expect(toMoney(adjusted)).toBe('835.1648');
  });

  it('round-trips a value through string and back unchanged', () => {
    const original = '5081.3927';
    expect(toMoney(toDecimal(original))).toBe(original);
  });
});

describe('sum', () => {
  it('rounds once at the end, not per addend', () => {
    expect(sum(['0.007', '0.007', '0.007'], 'money')).toBe('0.0210');
  });

  it('is zero for an empty list', () => {
    expect(sum([], 'money')).toBe('0.0000');
  });

  it('adds a column of money amounts exactly', () => {
    expect(sum(['835.1648', '1460.0000', '0.0001'], 'money')).toBe('2295.1649');
  });
});

describe('zero and scales', () => {
  it('produces a zero at the requested scale', () => {
    expect(zero('money')).toBe('0.0000');
    expect(zero('rate')).toBe('0.000000');
  });

  it('keeps the scale table aligned with the column shapes', () => {
    expect(DECIMAL_SCALES).toEqual({
      money: 4,
      rate: 6,
      measure: 4,
      poundsPerTonne: 8,
      unitCost: 8,
    });
  });

  it('carries a unit cost finer than a cent', () => {
    expect(zero('unitCost')).toBe('0.00000000');
    expect(fromDecimal(toDecimal('0.0532109'), 'unitCost')).toBe('0.05321090');
    expect(fromDecimal(toDecimal('0.0532109'), 'money')).toBe('0.0532');
  });
});

describe('constructor isolation', () => {
  it('is unaffected by the library-global Big config', async () => {
    const { default: Big } = await import('big.js');
    const originalDp = Big.DP;
    const originalRm = Big.RM;
    try {
      Big.DP = 0;
      Big.RM = 0;
      expect(fromDecimal(toDecimal('0.48275'), 'money')).toBe('0.4828');
      expect(toDecimal('760').div(toDecimal('0.91')).toFixed(4)).toBe('835.1648');
    } finally {
      Big.DP = originalDp;
      Big.RM = originalRm;
    }
  });
});

describe('decimalString aborts rather than merely refusing', () => {
  const SCHEMAS = [
    ['moneySchema', moneySchema, DECIMAL_SCALES.money],
    ['rateSchema', rateSchema, DECIMAL_SCALES.rate],
    ['measureSchema', measureSchema, DECIMAL_SCALES.measure],
    ['poundsPerTonneSchema', poundsPerTonneSchema, DECIMAL_SCALES.poundsPerTonne],
    ['unitCostSchema', unitCostSchema, DECIMAL_SCALES.unitCost],
  ] as const;

  it.each(SCHEMAS)(
    '%s answers rather than throwing on a string big.js cannot read',
    (_n, schema) => {
      for (const value of ['abc', '', '   ', '-', '.', '1.2.3']) {
        const result = schema.safeParse(value);
        expect(result.success, `${String(value)} should be refused, not accepted`).toBe(false);
      }
    },
  );

  it.each(SCHEMAS)('%s keeps the issue on the field inside an object', (_n, schema) => {
    const result = z.object({ amount: schema }).safeParse({ amount: 'abc' });

    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path.join('.'))).toEqual(['amount']);
  });

  it('stops a refinement layered on top from ever running', () => {
    const guarded = measureSchema.refine(() => {
      throw new Error('the refinement ran on a value the shape check rejected');
    });

    expect(guarded.safeParse('abc').success).toBe(false);
  });

  it('stops an OBJECT-level refinement too, which is the subtler half', () => {
    const guarded = z.object({ feet: measureSchema }).refine(() => {
      throw new Error('the object refinement ran on an invalid field');
    });

    expect(guarded.safeParse({ feet: 'abc' }).success).toBe(false);
  });

  it('still refuses the near-misses, with the message it always gave', () => {
    for (const value of ['4.70008', '1e3']) {
      const result = measureSchema.safeParse(value);
      expect(result.success, value).toBe(false);
      expect(result.error?.issues[0]?.message, value).toBe(
        `expected a decimal with at most ${String(DECIMAL_SCALES.measure)} places`,
      );
    }
  });

  it('still accepts a valid figure, and still trims it', () => {
    expect(measureSchema.parse('  2614.5  ')).toBe('2614.5');
    expect(measureSchema.parse('-5')).toBe('-5');
    expect(moneySchema.parse('0.0000')).toBe('0.0000');
  });
});

describe('formatMoney', () => {
  it('groups thousands and pads to two places', () => {
    expect(formatMoney('5817.2300')).toBe('$5,817.23');
    expect(formatMoney('0.00')).toBe('$0.00');
    expect(formatMoney('472.3')).toBe('$472.30');
    expect(formatMoney('3760000.00')).toBe('$3,760,000.00');
  });

  it('puts the sign outside the currency symbol', () => {
    expect(formatMoney('-41.5')).toBe('-$41.50');
    expect(formatMoney('-3608.4100')).toBe('-$3,608.41');
  });

  it('rounds half-up rather than truncating', () => {
    expect(formatMoney('0.007')).toBe('$0.01');
    expect(formatMoney('4.996')).toBe('$5.00');
    expect(formatMoney('52.4167')).toBe('$52.42');

    expect(formatMoney('318.2439')).toBe('$318.24');
  });

  it('rounds a negative by magnitude, matching toMoney', () => {
    expect(formatMoney('-7.385')).toBe('-$7.39');
    expect(formatMoney('-7.384')).toBe('-$7.38');
  });

  it('carries into the grouped whole part', () => {
    expect(formatMoney('99999.996')).toBe('$100,000.00');
    expect(formatMoney('999999.995')).toBe('$1,000,000.00');
  });

  it('never parses the string into a number', () => {
    expect(formatMoney('27021597764222977.61')).toBe('$27,021,597,764,222,977.61');
  });
});

describe('formatMoney against a formatter that truncates instead of rounding', () => {
  function truncatingMoney(value: string): string {
    const negative = value.startsWith('-');
    const [whole = '0', fraction = ''] = value.replace('-', '').split('.');
    const padded = (fraction + '00').slice(0, 2);
    const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return `${negative ? '-' : ''}$${grouped}.${padded}`;
  }

  const inputs: string[] = [];
  for (const whole of ['0', '1', '12', '587', '3071', '52816', '6390428', '999999999']) {
    for (const frac of ['', '0000', '3700', '9999', '0300', '1', '05', '999']) {
      inputs.push(frac === '' ? whole : `${whole}.${frac}`);
      inputs.push(frac === '' ? `-${whole}` : `-${whole}.${frac}`);
    }
  }

  it('differs only where rounding carries up or turns a negative into zero', () => {
    expect(inputs).toHaveLength(128);
    const differing = inputs.filter((input) => formatMoney(input) !== truncatingMoney(input));

    for (const input of differing) {
      const truncated = truncatingMoney(input);
      const rounded = formatMoney(input);

      const roundsUp = truncated.endsWith('.99') && rounded.endsWith('.00');

      const negativeZero = truncated === '-$0.00' && rounded === '$0.00';
      expect(roundsUp || negativeZero, `${input}: truncated ${truncated}, rounded ${rounded}`).toBe(
        true,
      );
    }

    expect(differing).toHaveLength(8 * 2 * 2 + 2);
  });
});

describe('roundToCents', () => {
  it('returns a column-scale string whose tail is zeros', () => {
    expect(roundToCents('318.2439')).toBe('318.2400');
    expect(roundToCents('52.4167')).toBe('52.4200');
  });

  it('rounds half-up, the same rule the display uses', () => {
    expect(roundToCents('0.4350')).toBe('0.4400');
    expect(roundToCents('0.4349')).toBe('0.4300');
    expect(roundToCents('-27.9950')).toBe('-28.0000');
  });

  it('makes the defect arithmetic come out', () => {
    const stored = ['318.2439', '52.4167'];
    expect(sum(stored, 'money')).toBe('370.6606');
    expect(sum(stored.map(roundToCents), 'money')).toBe('370.6600');
    expect(formatMoney(sum(stored.map(roundToCents), 'money'))).toBe('$370.66');

    expect(formatMoney(stored[0] as string)).toBe('$318.24');
    expect(formatMoney(stored[1] as string)).toBe('$52.42');
  });

  it('leaves a figure that is already whole cents alone', () => {
    expect(roundToCents('1940.0000')).toBe('1940.0000');
    expect(roundToCents('0.0000')).toBe('0.0000');
  });
});

describe('formatMeasure — a stored measure as a person reads it', () => {
  it('drops the scale trailing zeros and groups thousands', () => {
    expect(formatMeasure('1250.0000')).toBe('1,250');
    expect(formatMeasure('4805613.0000')).toBe('4,805,613');
  });

  it('keeps a real fraction', () => {
    expect(formatMeasure('3627.2000')).toBe('3,627.2');
    expect(formatMeasure('58.0713')).toBe('58.0713');
  });

  it('never re-rounds and never goes through a float', () => {
    expect(formatMeasure('99999999.9999')).toBe('99,999,999.9999');
  });

  it('handles a value with no decimal point at all', () => {
    expect(formatMeasure('6800')).toBe('6,800');
  });
});

describe('positiveDecimal — the guard at the door', () => {
  const feet = positiveDecimal(measureSchema, 'custom length', 'measure');

  it('accepts a real figure', () => {
    expect(feet.safeParse('1250.0000').success).toBe(true);
  });

  it('refuses zero and a negative, naming the field the form uses', () => {
    for (const value of ['0', '0.0000', '-5']) {
      const result = feet.safeParse(value);

      expect(result.success, `expected ${value} to be refused`).toBe(false);
      expect(result.error?.issues[0]?.message).toContain('custom length');
    }
  });

  it('still refuses a figure wider than its column', () => {
    expect(feet.safeParse('999999999.0000').success).toBe(false);
  });

  it('carries whatever field name its caller gives it', () => {
    const basis = positiveDecimal(measureSchema, 'basis weight', 'measure');

    expect(basis.safeParse('0').error?.issues[0]?.message).toContain('basis weight');
  });
});

describe('formatPricePerPound - four places, never the cent', () => {
  it('keeps all four stored places, trailing zeros included', () => {
    expect(formatPricePerPound('0.5483')).toBe('$0.5483');
    expect(formatPricePerPound('0.7100')).toBe('$0.7100');
  });

  it('groups thousands and prints a whole figure bare', () => {
    expect(formatPricePerPound('2918.7000')).toBe('$2,918.7000');
    expect(formatPricePerPound('2')).toBe('$2');
  });
});

describe('formatRatePercent - a stored ratio as a percent', () => {
  it('prints tax rates as a customer reads them', () => {
    expect(formatRatePercent('0.080000')).toBe('8%');
    expect(formatRatePercent('0.077000')).toBe('7.7%');
    expect(formatRatePercent('0.076500')).toBe('7.65%');
  });

  it('keeps every stored place and never rounds', () => {
    expect(formatRatePercent('0.418273')).toBe('41.8273%');
    expect(formatRatePercent('0.000001')).toBe('0.0001%');
  });

  it('prints zero, whole ratios and short strings', () => {
    expect(formatRatePercent('0.000000')).toBe('0%');
    expect(formatRatePercent('0')).toBe('0%');
    expect(formatRatePercent('1.000000')).toBe('100%');
    expect(formatRatePercent('7.5')).toBe('750%');
    expect(formatRatePercent('0.09')).toBe('9%');
  });

  it('keeps a sign, and drops it from zero', () => {
    expect(formatRatePercent('-0.120000')).toBe('-12%');
    expect(formatRatePercent('-0.000000')).toBe('0%');
  });
});

describe('formatEstimatedPounds - the estimate at two places, as the screens print it', () => {
  it('rounds half-up to two places and groups thousands', () => {
    expect(formatEstimatedPounds('731.2600')).toBe('731.26');
    expect(formatEstimatedPounds('2486.3150')).toBe('2,486.32');
    expect(formatEstimatedPounds('94')).toBe('94.00');
  });
});
