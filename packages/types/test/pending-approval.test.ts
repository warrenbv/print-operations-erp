// Tests for the Approvals queue union.
import { describe, expect, it } from 'vitest';

import {
  pendingApprovalListResponseSchema,
  pendingApprovalSchema,
  type PendingCreditHold,
  type PendingPriceOverride,
} from '../src/pending-approval';

const creditHold: PendingCreditHold = {
  kind: 'credit-hold',
  approvalId: '0198c2e6-2222-7000-8000-000000000001',
  customerId: '0198c2e6-2222-7000-8000-000000000002',
  reason: 'Live opportunity; account is being sorted out with AR.',
  requestedBy: 'dev-sales',
  requestedAt: '2026-08-25T16:05:00.000Z',
};

const priceOverride: PendingPriceOverride = {
  kind: 'price-override',
  quoteId: '0198c2e6-3333-7000-8000-000000000001',
  customerId: '0198c2e6-3333-7000-8000-000000000002',
  quoteNumber: 7,
  versionNumber: 2,
  salesRep: 'dev-sales',
  requestedAt: '2026-08-25T16:10:00.000Z',
  needs: ['price'],
};

describe('pendingApprovalSchema', () => {
  it.each([
    ['a credit hold', creditHold],
    ['a price override', priceOverride],
  ])('accepts %s', (_label, item) => {
    expect(pendingApprovalSchema.parse(item)).toEqual(item);
  });

  it.each([[['floor']], [['price', 'floor']]])('accepts a quote that needs %j decided', (needs) => {
    const item = { ...priceOverride, needs };
    expect(pendingApprovalSchema.parse(item)).toEqual(item);
  });

  it.each([
    ['an unknown kind', { ...creditHold, kind: 'timesheet' }],
    ['a credit hold with an empty reason', { ...creditHold, reason: '  ' }],
    ['a price override with a non-ISO date', { ...priceOverride, requestedAt: 'yesterday' }],

    ['a price override that needs nothing', { ...priceOverride, needs: [] }],
    ['a price override with no needs', omit(priceOverride, 'needs')],
    ['a price override needing an unknown kind', { ...priceOverride, needs: ['margin'] }],
  ])('rejects %s', (_label, item) => {
    expect(safeParses(item)).toBe(false);
  });
});

describe('pendingApprovalListResponseSchema', () => {
  it('accepts a mixed list', () => {
    const payload = { items: [creditHold, priceOverride] };
    expect(pendingApprovalListResponseSchema.parse(payload)).toEqual(payload);
  });

  it('rejects a bare array', () => {
    expect(pendingApprovalListResponseSchema.safeParse([creditHold]).success).toBe(false);
  });
});

function safeParses(item: unknown): boolean {
  return pendingApprovalSchema.safeParse(item).success;
}

function omit<T extends object>(obj: T, key: keyof T & string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(obj).filter(([k]) => k !== key));
}
