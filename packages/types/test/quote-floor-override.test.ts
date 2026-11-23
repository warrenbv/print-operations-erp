// Tests for the floor override: its kind, its decision record and the reason it requires:
// docs/product/requirements.md (R6).
import { describe, expect, it } from 'vitest';

import {
  floorOverrideDecisionRequestSchema,
  overrideDecisionRequestSchema,
  QUOTE_OVERRIDE_KINDS,
  quoteOverrideDecisionSchema,
  quoteSchema,
  type QuoteOverrideDecision,
} from '../src/quote';

const DECISION: QuoteOverrideDecision = {
  id: '01988a00-0761-7000-8000-000000000001',
  quoteId: '01988a00-0761-7000-8000-000000000002',
  decision: 'approved',
  kind: 'floor',
  actor: 'dev-admin',
  reason: 'Strategic account; finance agreed the margin.',
  at: '2026-11-02T16:00:00.000Z',
};

describe('QUOTE_OVERRIDE_KINDS', () => {
  it('is the hand-set price and the floor', () => {
    expect(QUOTE_OVERRIDE_KINDS).toEqual(['price', 'floor']);
  });
});

describe('quoteOverrideDecisionSchema', () => {
  it.each(QUOTE_OVERRIDE_KINDS)('accepts a decision of kind %s', (kind) => {
    const decision = { ...DECISION, kind };
    expect(quoteOverrideDecisionSchema.parse(decision)).toEqual(decision);
  });

  it('refuses a decision that names no kind', () => {
    const unnamed: Record<string, unknown> = { ...DECISION };
    delete unnamed.kind;
    expect(quoteOverrideDecisionSchema.safeParse(unnamed).success).toBe(false);
  });

  it('refuses a kind outside the set', () => {
    expect(quoteOverrideDecisionSchema.safeParse({ ...DECISION, kind: 'margin' }).success).toBe(
      false,
    );
  });
});

describe('floorOverrideDecisionRequestSchema', () => {
  const REQUEST = { actor: 'dev-admin', lockVersion: '3', reason: 'Agreed with finance.' };

  it('accepts a reason and coerces the posted lock version', () => {
    expect(floorOverrideDecisionRequestSchema.parse(REQUEST)).toEqual({
      ...REQUEST,
      lockVersion: 3,
    });
  });

  it.each([
    ['no reason', { reason: undefined }],
    ['a blank reason', { reason: '   ' }],
    ['a reason over 500 characters', { reason: 'x'.repeat(501) }],
  ])('refuses %s', (_label, change) => {
    expect(floorOverrideDecisionRequestSchema.safeParse({ ...REQUEST, ...change }).success).toBe(
      false,
    );
  });

  it('leaves the price decision with its reason optional', () => {
    expect(overrideDecisionRequestSchema.safeParse({ ...REQUEST, reason: undefined }).success).toBe(
      true,
    );
  });
});

describe('quoteSchema floor override pair', () => {
  const QUOTE = {
    id: '01988a00-0761-7000-8000-000000000002',
    customerId: '01988a00-0761-7000-8000-000000000003',
    status: 'draft',
    rootQuoteId: '01988a00-0761-7000-8000-000000000002',
    versionNumber: 1,
    quoteNumber: 7,
    lockVersion: 1,
    freightInRollPrice: false,
    createdAt: '2026-11-02T16:00:00.000Z',
    updatedAt: '2026-11-02T16:00:00.000Z',
  };

  it('carries the live override', () => {
    const overridden = {
      ...QUOTE,
      floorOverrideBy: 'dev-admin',
      floorOverrideAt: '2026-11-02T16:05:00.000Z',
    };
    expect(quoteSchema.parse(overridden)).toEqual(overridden);
  });

  it('leaves both out while no override is in force', () => {
    const parsed = quoteSchema.parse(QUOTE);
    expect(parsed).not.toHaveProperty('floorOverrideBy');
    expect(parsed).not.toHaveProperty('floorOverrideAt');
  });
});
