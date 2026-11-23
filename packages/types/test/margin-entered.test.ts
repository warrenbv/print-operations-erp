// Tests for the price source list and the margin entered by hand on a line.
import { describe, expect, it } from 'vitest';

import {
  MARGIN_ENTERED_MAX,
  PRICE_SOURCES,
  marginOverridePctSchema,
  priceSourceSchema,
  quoteLineRequestSchema,
  type PriceSource,
} from '../src/quote-calculation';
import { quoteLineSchema } from '../src/quote';

describe('price source', () => {
  it('names the four ways a line is priced, the margin entered manually and the agreed price included', () => {
    const sources: readonly PriceSource[] = PRICE_SOURCES;

    expect([...sources]).toEqual(['tier', 'manual', 'margin', 'agreed']);
    expect(priceSourceSchema.safeParse('typed').success).toBe(false);
  });

  it('is the one list the stored line reads too', () => {
    expect(quoteLineSchema.shape.priceSource.options).toEqual([...PRICE_SOURCES]);
  });
});

describe('marginOverridePctSchema', () => {
  it('takes a margin to one decimal place of a percent, from just above 0 to 95%', () => {
    for (const ok of ['0.001000', '0.270000', '0.410000', '0.418000', MARGIN_ENTERED_MAX]) {
      expect(marginOverridePctSchema.safeParse(ok).success).toBe(true);
    }
  });

  it('refuses nothing or less, more than 95%, and anything finer than a tenth of a percent', () => {
    for (const bad of ['0.000000', '-0.160000', '0.951000', '0.985000', '0.271400', '33']) {
      expect(marginOverridePctSchema.safeParse(bad).success).toBe(false);
    }
  });

  it('is optional on the line request, and absent means the tier prices it', () => {
    const request = { gradeId: 'g', footageVariant: 'short', rollWidthIn: 24, quantityRolls: 100 };
    expect(quoteLineRequestSchema.parse(request)).not.toHaveProperty('marginOverridePct');
    expect(
      quoteLineRequestSchema.parse({ ...request, marginOverridePct: '0.380000' }).marginOverridePct,
    ).toBe('0.380000');
  });
});
