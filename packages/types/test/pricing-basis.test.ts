// Tests for the pricing basis list and its default on a quote line.
import { describe, expect, it } from 'vitest';

import { PRICING_BASES, pricingBasisSchema } from '../src/pricing-basis';
import { quoteLineRequestSchema } from '../src/quote-calculation';

describe('pricing basis', () => {
  it('carries the two bases a line can be priced on', () => {
    expect([...PRICING_BASES]).toEqual(['per_roll', 'per_pound']);
  });

  it('refuses anything else', () => {
    expect(pricingBasisSchema.safeParse('per_ton').success).toBe(false);
    expect(pricingBasisSchema.safeParse('PER_POUND').success).toBe(false);
  });
});

describe('quoteLineRequestSchema.pricingBasis', () => {
  const request = {
    gradeId: 'g',
    footageVariant: 'short',
    rollWidthIn: 24,
    quantityRolls: 100,
  };

  it('defaults to per_roll when a caller does not state one', () => {
    const parsed = quoteLineRequestSchema.parse(request);
    expect(parsed.pricingBasis).toBe('per_roll');
  });

  it('takes per_pound when one is stated', () => {
    const parsed = quoteLineRequestSchema.parse({ ...request, pricingBasis: 'per_pound' });
    expect(parsed.pricingBasis).toBe('per_pound');
  });

  it('refuses a basis the engine cannot price', () => {
    expect(quoteLineRequestSchema.safeParse({ ...request, pricingBasis: 'per_ton' }).success).toBe(
      false,
    );
  });
});
