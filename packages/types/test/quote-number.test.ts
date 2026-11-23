// Tests for formatting and parsing the quote number.
import { describe, expect, it } from 'vitest';

import { formatQuoteNumber, parseQuoteNumber, quoteReference } from '../src/quote-number';

describe('formatQuoteNumber', () => {
  it('pads to five digits behind the Q- prefix', () => {
    expect(formatQuoteNumber(1)).toBe('Q-00001');
    expect(formatQuoteNumber(38270)).toBe('Q-38270');
  });

  it('stops padding rather than truncating past five digits', () => {
    expect(formatQuoteNumber(100000)).toBe('Q-100000');
  });

  it('refuses a counter that is not a positive integer', () => {
    expect(() => formatQuoteNumber(0)).toThrow(RangeError);
    expect(() => formatQuoteNumber(4.5)).toThrow(RangeError);
    expect(() => formatQuoteNumber(-3)).toThrow(RangeError);
  });
});

describe('quoteReference', () => {
  it('names a first version by its number alone', () => {
    expect(quoteReference({ quoteNumber: 1, versionNumber: 1 })).toBe('Q-00001');
  });

  it('adds the version from v2 on', () => {
    expect(quoteReference({ quoteNumber: 1, versionNumber: 2 })).toBe('Q-00001 v2');
    expect(quoteReference({ quoteNumber: 318, versionNumber: 10 })).toBe('Q-00318 v10');
  });
});

describe('parseQuoteNumber', () => {
  it.each([
    ['Q-00001', 1],
    ['q-1', 1],
    ['Q00001', 1],
    ['Q 00063', 63],
    ['00026', 26],
    ['1', 1],
    ['  Q-00318  ', 318],
    ['Q-00318 v2', 318],
    ['q-318v3', 318],
    ['274913', 274913],
  ])('reads %j as %d', (text, expected) => {
    expect(parseQuoteNumber(text)).toBe(expected);
  });

  it.each(['', 'Acme', 'Q-', 'Q-0', '0', '00000', 'DPW-04718', '12a', 'Q-1-2', '4.5'])(
    'reads %j as not a quote number',
    (text) => {
      expect(parseQuoteNumber(text)).toBeUndefined();
    },
  );

  it('reads back what formatQuoteNumber and quoteReference print', () => {
    for (const counter of [1, 9, 10, 99999, 100000]) {
      expect(parseQuoteNumber(formatQuoteNumber(counter))).toBe(counter);
      expect(parseQuoteNumber(quoteReference({ quoteNumber: counter, versionNumber: 3 }))).toBe(
        counter,
      );
    }
  });
});
