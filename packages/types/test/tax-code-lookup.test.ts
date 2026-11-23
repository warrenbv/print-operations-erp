// Tests for the tax code lookup request, its response and when an answer fills the jurisdiction.
import { describe, expect, it } from 'vitest';

import {
  TAX_CODE_LOOKUP_OUTCOMES,
  taxCodeLookupFills,
  taxCodeLookupRequestSchema,
  taxCodeLookupResponseSchema,
} from '../src/tax-code-lookup';

describe('taxCodeLookupRequestSchema', () => {
  it('takes the four boxes as typed, trimmed', () => {
    expect(
      taxCodeLookupRequestSchema.parse({
        line1: ' 200 Sample Road ',
        city: 'Sample City',
        postalCode: '99000-4071',
        state: 'WA',
      }),
    ).toEqual({
      line1: '200 Sample Road',
      city: 'Sample City',
      postalCode: '99000-4071',
      state: 'WA',
    });
  });

  it('reads a missing box as blank, so the API can say what to type', () => {
    expect(taxCodeLookupRequestSchema.parse({})).toEqual({
      line1: '',
      city: '',
      postalCode: '',
      state: '',
    });
  });

  it('refuses a box longer than the delivery box it came from', () => {
    expect(taxCodeLookupRequestSchema.safeParse({ line1: 'x'.repeat(201) }).success).toBe(false);
    expect(taxCodeLookupRequestSchema.safeParse({ postalCode: '99000-40718' }).success).toBe(false);
    expect(taxCodeLookupRequestSchema.safeParse({ state: 'WAS' }).success).toBe(false);
  });
});

describe('taxCodeLookupResponseSchema', () => {
  it('reads a fill with every figure', () => {
    const answer = {
      outcome: 'matched',
      locationCode: '9010',
      key: 'WA-9010',
      name: 'SAMPLE CITY',
      ourRate: '0.087',
      effectiveFrom: '2026-10-01',
      stateRate: '0.087',
    };
    expect(taxCodeLookupResponseSchema.parse(answer)).toEqual(answer);
  });

  it('reads an outcome with no figures, and refuses an outcome it does not know', () => {
    expect(taxCodeLookupResponseSchema.parse({ outcome: 'unavailable' })).toEqual({
      outcome: 'unavailable',
    });
    expect(taxCodeLookupResponseSchema.safeParse({ outcome: 'maybe' }).success).toBe(false);
  });

  it('refuses a key or a code of any other shape', () => {
    expect(
      taxCodeLookupResponseSchema.safeParse({ outcome: 'matched', key: 'WA-468' }).success,
    ).toBe(false);
    expect(
      taxCodeLookupResponseSchema.safeParse({ outcome: 'matched', locationCode: '468' }).success,
    ).toBe(false);
  });
});

describe('taxCodeLookupFills', () => {
  it('fills on the three located outcomes only, and only with a key', () => {
    const filling = TAX_CODE_LOOKUP_OUTCOMES.filter((outcome) =>
      taxCodeLookupFills({ outcome, key: 'WA-9010' }),
    );
    expect(filling).toEqual(['matched', 'matched_zip4', 'corrected']);
    expect(taxCodeLookupFills({ outcome: 'matched' })).toBe(false);
  });
});
