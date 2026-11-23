// Tests measure formatting, the roll width parser and what a measure box accepts.
import { describe, expect, it } from 'vitest';

import {
  formatFeet,
  formatWidth,
  notAWidth,
  POSITIVE_MEASURE_PATTERN,
  typedWidth,
} from './measures';

describe('formatFeet', () => {
  it('drops the trailing zeros the measure scale carries', () => {
    expect(formatFeet('1000.0000')).toBe('1,000');
    expect(formatFeet('0.0000')).toBe('0');
  });

  it('keeps a real fraction', () => {
    expect(formatFeet('2867.2500')).toBe('2,867.25');
    expect(formatFeet('38.0712')).toBe('38.0712');
  });

  it('groups thousands', () => {
    expect(formatFeet('4718293.0000')).toBe('4,718,293');
    expect(formatFeet('999.0000')).toBe('999');
  });

  it('handles a value with no decimal point at all', () => {
    expect(formatFeet('6845')).toBe('6,845');
  });
});

describe('formatWidth', () => {
  it('prints a whole width as before, and marks a custom one', () => {
    expect(formatWidth({ rollWidthIn: 24 })).toBe('24"');
    expect(formatWidth({ rollWidthIn: 17, customWidth: true })).toBe('17" custom');
  });

  it('prints a stock width in sixteenths as its fraction', () => {
    expect(formatWidth({ rollWidthIn: 11.3125 })).toBe('11 5/16"');
    expect(formatWidth({ rollWidthIn: 9.75, customWidth: false })).toBe('9 3/4"');
  });
});

describe('typedWidth and notAWidth', () => {
  it('reads whole inches and sixteenths typed as a decimal', () => {
    expect(typedWidth('12')).toBe(12);
    expect(typedWidth('9.75')).toBe(9.75);
    expect(typedWidth('11.3125')).toBe(11.3125);
    expect(typedWidth('9.750')).toBe(9.75);
  });

  it('reads nothing from a figure that is not a width', () => {
    for (const text of ['13.9', '0', '1001', '1e3', '-9', 'wide', '9 3/4', '']) {
      expect(typedWidth(text), text).toBeUndefined();
    }
  });

  it('says what a width is, naming the figure typed', () => {
    expect(notAWidth('13.9')).toBe(
      '13.9 is not a width. A width is whole inches or sixteenths of an inch from 1 to 1000, typed as a decimal: 11.3125 for 11 5/16.',
    );
  });
});

describe('POSITIVE_MEASURE_PATTERN — what a measure box accepts', () => {
  const accepts = (value: string) => new RegExp(`^(?:${POSITIVE_MEASURE_PATTERN})$`).test(value);

  it('accepts a real length, with or without a fraction', () => {
    expect(accepts('1250')).toBe(true);
    expect(accepts('1385.5')).toBe(true);
    expect(accepts('0.0001')).toBe(true);
  });

  it('refuses zero however it is written', () => {
    expect(accepts('0')).toBe(false);
    expect(accepts('0.0000')).toBe(false);
    expect(accepts('00.00')).toBe(false);
  });

  it('refuses a negative and anything that is not a number', () => {
    expect(accepts('-5')).toBe(false);
    expect(accepts('1,250')).toBe(false);
    expect(accepts('twelve')).toBe(false);
    expect(accepts('')).toBe(false);
  });

  it('refuses a figure past the column, and a fifth decimal place', () => {
    expect(accepts('99999999')).toBe(true);
    expect(accepts('999999999')).toBe(false);
    expect(accepts('7.25003')).toBe(false);
  });
});
