// How a roll is described: width, fractions of an inch, custom widths and feet per roll.
import { describe, expect, it } from 'vitest';

import { rollSpec, rollSpecForCustomer } from '../src/templates/document-formatting';

describe('rollSpec', () => {
  it('names a stock width in inches with the feet per roll', () => {
    expect(rollSpec({ rollWidthIn: 24, footageVariant: 'long', feetPerRoll: '1250.0000' })).toBe(
      '24" × 1,250 ft (long)',
    );
    expect(rollSpec({ rollWidthIn: 24, customWidth: false, footageVariant: 'long' })).toBe(
      '24" × long',
    );
  });

  it('marks a custom width, because the floor cuts to it', () => {
    expect(
      rollSpec({
        rollWidthIn: 17,
        customWidth: true,
        footageVariant: 'long',
        feetPerRoll: '1250.0000',
      }),
    ).toBe('17" custom × 1,250 ft (long)');
  });

  it('names a stock width in sixteenths as its fraction', () => {
    expect(
      rollSpec({ rollWidthIn: 11.3125, footageVariant: '500', feetPerRoll: '1480.0000' }),
    ).toBe('11 5/16" × 1,480 ft (500)');
    expect(rollSpec({ rollWidthIn: 9.75, footageVariant: '500', feetPerRoll: '1260.0000' })).toBe(
      '9 3/4" × 1,260 ft (500)',
    );
    expect(rollSpec({ rollWidthIn: 4.625, footageVariant: '500', feetPerRoll: '1530.0000' })).toBe(
      '4 5/8" × 1,530 ft (500)',
    );
  });
});

describe('rollSpecForCustomer', () => {
  it('drops the variant code after the feet', () => {
    expect(
      rollSpecForCustomer({ rollWidthIn: 24, footageVariant: 'long', feetPerRoll: '1250.0000' }),
    ).toBe('24" × 1,250 ft');
    expect(
      rollSpecForCustomer({ rollWidthIn: 24, footageVariant: 'short', feetPerRoll: '960.0000' }),
    ).toBe('24" × 960 ft');
  });

  it('prints a custom width and a width in sixteenths as rollSpec does', () => {
    expect(
      rollSpecForCustomer({
        rollWidthIn: 17,
        customWidth: true,
        footageVariant: 'long',
        feetPerRoll: '1250.0000',
      }),
    ).toBe('17" custom × 1,250 ft');
    expect(
      rollSpecForCustomer({
        rollWidthIn: 11.3125,
        footageVariant: '500',
        feetPerRoll: '1480.0000',
      }),
    ).toBe('11 5/16" × 1,480 ft');
  });

  it('keeps the variant on a line with no feet, where it is the only length', () => {
    expect(rollSpecForCustomer({ rollWidthIn: 24, footageVariant: 'long' })).toBe('24" × long');
  });
});
