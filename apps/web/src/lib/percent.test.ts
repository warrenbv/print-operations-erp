// Tests percent to ratio conversion and back, the percent box pattern, and how a stored rate prints.
import { formatRatePercent } from '@erp/types';
import { describe, expect, it } from 'vitest';

import { PERCENT_PATTERN, percentToRatio, ratioToPercent } from './percent';

describe('percentToRatio', () => {
  const floor = { subject: 'Margin floor %', maxExclusive: '1' };

  it('divides by 100 and stores at rate scale', () => {
    expect(percentToRatio('12', floor)).toEqual({ ok: true, ratio: '0.120000' });
  });

  it('is exact on a value binary floating point is not', () => {
    expect(percentToRatio('16.7', floor)).toEqual({ ok: true, ratio: '0.167000' });
  });

  it('takes zero', () => {
    expect(percentToRatio('0', floor)).toEqual({ ok: true, ratio: '0.000000' });
  });

  it('refuses a value that is not a number of percent, quoting what was typed', () => {
    const result = percentToRatio('fifteen', floor);
    expect(result).toEqual({
      ok: false,
      message: 'Margin floor % must be a number of percent, such as 12. You entered "fifteen".',
    });
  });

  it('refuses a negative, which every one of these columns also refuses', () => {
    expect(percentToRatio('-3', floor).ok).toBe(false);
  });

  it('refuses a percent sign, rather than reading past it', () => {
    expect(percentToRatio('12%', floor).ok).toBe(false);
  });

  it('refuses 100 or more when the column is bounded, in the units the box uses', () => {
    expect(percentToRatio('287', floor)).toEqual({
      ok: false,
      message: 'Margin floor % must be under 100%. You entered 287%.',
    });
    expect(percentToRatio('100', floor).ok).toBe(false);
    expect(percentToRatio('99.9999', floor).ok).toBe(true);
  });

  it('allows a value above 100 where the column has no ceiling', () => {
    const surcharge = { subject: 'Overwrap surcharge %' };
    expect(percentToRatio('235', surcharge)).toEqual({ ok: true, ratio: '2.350000' });
    expect(percentToRatio('-1', surcharge).ok).toBe(false);
  });

  it('rounds to the column scale, half up, at the fifth decimal of a percent', () => {
    expect(percentToRatio('23.41875', floor)).toEqual({ ok: true, ratio: '0.234188' });
  });
});

describe('ratioToPercent', () => {
  it('multiplies by 100 and drops the trailing zeros the column carries', () => {
    expect(ratioToPercent('0.420000')).toBe('42');
    expect(ratioToPercent('0.090000')).toBe('9');
    expect(ratioToPercent('0.000000')).toBe('0');
  });

  it('keeps every place a stored value really has', () => {
    expect(ratioToPercent('0.163250')).toBe('16.325');
  });

  it('round-trips against percentToRatio', () => {
    for (const stored of ['0.000000', '0.090000', '0.420000', '0.263500', '0.999999']) {
      const percent = ratioToPercent(stored);
      expect(percentToRatio(percent, { subject: 'x', maxExclusive: '1' })).toEqual({
        ok: true,
        ratio: stored,
      });
    }
  });
});

describe('PERCENT_PATTERN', () => {
  it('accepts and refuses exactly what the collector does', () => {
    const browser = new RegExp(`^(?:${PERCENT_PATTERN})$`);
    for (const good of ['0', '15', '27.3', '99.981472']) {
      expect(browser.test(good)).toBe(true);
      expect(percentToRatio(good, { subject: 'x' }).ok).toBe(true);
    }
    for (const bad of ['', '-3', '15%', 'fifteen', '.5']) {
      expect(browser.test(bad)).toBe(false);
      expect(percentToRatio(bad, { subject: 'x' }).ok).toBe(false);
    }
  });
});

const RATE_PINS: [string, string][] = [
  ['0.040000', '4%'],
  ['0.047000', '4.7%'],
  ['0.090000', '9%'],
  ['0.045000', '4.5%'],
  ['0.076000', '7.6%'],
  ['0.067500', '6.75%'],
  ['0.113500', '11.35%'],
  ['0.074318', '7.4318%'],
  ['0.370000', '37%'],
  ['0.290000', '29%'],
  ['0.415000', '41.5%'],
  ['0.276913', '27.6913%'],
  ['0.163250', '16.325%'],
  ['0.450000', '45%'],
  ['0.999999', '99.9999%'],
  ['0.000001', '0.0001%'],
  ['0.007000', '0.7%'],
  ['0.000000', '0%'],
  ['0', '0%'],
  ['1.000000', '100%'],
  ['3.170000', '317%'],
  ['27.519304', '2751.9304%'],
  ['0.01', '1%'],
  ['2.4', '240%'],
  ['-0.040000', '-4%'],
  ['-0.418207', '-41.8207%'],
  ['-1.000000', '-100%'],
  ['-0.000001', '-0.0001%'],

  ['-0.000000', '0%'],
];

describe('formatRatePercent, as the web prints a stored rate', () => {
  it('prints a stored tax rate as the percent, never the six-place ratio', () => {
    expect(formatRatePercent('0.010000')).toBe('1%');
    expect(formatRatePercent('0.053000')).toBe('5.3%');
  });

  it('keeps every stored place, because a floor verdict is read off it', () => {
    expect(formatRatePercent('0.276913')).toBe('27.6913%');
    expect(formatRatePercent('0.163250')).toBe('16.325%');
  });

  it('prints what the tax-rate pages printed when they formatted floats themselves', () => {
    for (const rate of ['0.045000', '0.113500', '0.040000', '0.000000', '0.074318']) {
      expect(formatRatePercent(rate)).toBe(`${String(Number((Number(rate) * 100).toFixed(4)))}%`);
    }
  });

  it('keeps a sign and a leading zero', () => {
    expect(formatRatePercent('-0.040000')).toBe('-4%');
    expect(formatRatePercent('0.007000')).toBe('0.7%');
  });

  it.each(RATE_PINS)('prints %s as %s', (rate, printed) => {
    expect(formatRatePercent(rate)).toBe(printed);
  });
});
