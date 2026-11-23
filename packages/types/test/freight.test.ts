// Tests for the carrier freight input, freight folded into the roll price, and the delivered price per roll.
import { describe, expect, it } from 'vitest';

import {
  deliveredPricePerRollOf,
  freightInRollPriceApplies,
  freightInputSchema,
} from '../src/freight';

describe('freightInputSchema, carrier arm', () => {
  it('accepts a carrier line with no freight margin', () => {
    const parsed = freightInputSchema.parse({ mode: 'carrier', carrierBid: '250.0000' });

    expect(parsed).not.toHaveProperty('freightMarginPct');
  });

  it('rejects a null freight margin', () => {
    expect(() => freightInputSchema.parse({ mode: 'carrier', freightMarginPct: null })).toThrow();
  });

  it('still accepts a margin that is present', () => {
    const parsed = freightInputSchema.parse({
      mode: 'carrier',
      carrierBid: '250.0000',
      freightMarginPct: '0.120000',
    });

    expect(parsed).toEqual({
      mode: 'carrier',
      carrierBid: '250.0000',
      freightMarginPct: '0.120000',
    });
  });
});

describe('freightInRollPriceApplies', () => {
  const perRoll = { pricingBasis: 'per_roll' as const };
  const perPound = { pricingBasis: 'per_pound' as const };

  it('prints freight in the price when the flag is set and every line is per roll', () => {
    expect(freightInRollPriceApplies(true, [perRoll, perRoll])).toBe(true);
  });

  it('prints freight apart when the flag is not set', () => {
    expect(freightInRollPriceApplies(false, [perRoll])).toBe(false);
  });

  it('prints freight apart while any line is priced per pound, flag or no flag', () => {
    expect(freightInRollPriceApplies(true, [perRoll, perPound])).toBe(false);
  });
});

describe('deliveredPricePerRollOf', () => {
  it('is the extended price over the rolls, at four places', () => {
    expect(deliveredPricePerRollOf({ extendedPrice: '1863.0800', quantityRolls: 16 })).toBe(
      '116.4425',
    );
  });

  it('rounds half up at the fourth place, as every stored figure does', () => {
    expect(deliveredPricePerRollOf({ extendedPrice: '287.0004', quantityRolls: 8 })).toBe(
      '35.8751',
    );
  });
});
