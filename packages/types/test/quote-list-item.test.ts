// Tests for the quote list item schema.
import { describe, expect, it } from 'vitest';

import {
  quoteListItemSchema,
  quoteListResponseSchema,
  quoteSchema,
  quoteVersionsResponseSchema,
  type QuoteListItem,
} from '../src/quote';

const VALID: QuoteListItem = {
  id: '01988a00-0100-7000-8000-000000000001',
  customerId: '01988a00-0100-7000-8000-000000000002',
  status: 'draft',
  rootQuoteId: '01988a00-0100-7000-8000-000000000001',
  versionNumber: 1,
  quoteNumber: 7,
  lockVersion: 1,
  freightInRollPrice: false,
  createdAt: '2026-10-07T16:00:00.000Z',
  updatedAt: '2026-10-07T16:00:00.000Z',
  lineCount: 2,
  belowFloorCount: 1,
  manualCount: 1,
  manualPricePerRoll: '12.0000',
};

describe('quoteListItemSchema', () => {
  it('accepts a quote with its line summary', () => {
    expect(quoteListItemSchema.parse(VALID)).toEqual(VALID);
  });

  it('accepts no hand-set price as null on a quote with no lines', () => {
    const empty = {
      ...VALID,
      lineCount: 0,
      belowFloorCount: 0,
      manualCount: 0,
      manualPricePerRoll: null,
    };
    expect(quoteListItemSchema.parse(empty)).toEqual(empty);
  });

  it.each([
    ['a missing line count', { lineCount: undefined }],
    ['a negative count', { belowFloorCount: -1 }],
    ['a fractional count', { manualCount: 4.5 }],
    ['an absent hand-set price rather than null', { manualPricePerRoll: undefined }],
    ['a price that is not money', { manualPricePerRoll: '47.30002' }],
  ])('refuses %s', (_name, change) => {
    expect(quoteListItemSchema.safeParse({ ...VALID, ...change }).success).toBe(false);
  });

  it('is what the list answers, while the versions read stays headers only', () => {
    expect(quoteListResponseSchema.safeParse({ items: [VALID] }).success).toBe(true);

    const header = quoteSchema.parse(VALID);
    expect(header).not.toHaveProperty('lineCount');
    expect(quoteListResponseSchema.safeParse({ items: [header] }).success).toBe(false);
    expect(quoteVersionsResponseSchema.safeParse({ items: [header] }).success).toBe(true);
  });
});
