// Tests the Approvals helpers.
import { describe, expect, it } from 'vitest';

import type { PendingApproval } from '@erp/types';

import {
  agreedPriceSentence,
  approvalAskers,
  approvalCustomerIds,
  belowFloorLines,
  belowFloorSentence,
  enteredMarginSentence,
  handSetLines,
  handSetReason,
  needsWords,
  orderKinds,
  partitionApprovals,
  tierLineCount,
} from './derive';

const creditHold = (approvalId: string): PendingApproval => ({
  kind: 'credit-hold',
  approvalId,
  customerId: '0198c2e6-2222-7000-8000-000000000002',
  reason: 'live opportunity',
  requestedBy: 'dev-sales',
  requestedAt: '2026-08-25T16:05:00.000Z',
});

const priceOverride = (quoteId: string): PendingApproval => ({
  kind: 'price-override',
  quoteId,
  customerId: 'customer-b',
  quoteNumber: 7,
  versionNumber: 1,
  requestedAt: '2026-08-25T16:10:00.000Z',
  needs: ['price'],
});

describe('partitionApprovals', () => {
  it('splits a mixed list into its two sections', () => {
    const split = partitionApprovals([priceOverride('q1'), creditHold('a1')]);
    expect(split.creditHolds.map((c) => c.approvalId)).toEqual(['a1']);
    expect(split.priceOverrides.map((p) => p.quoteId)).toEqual(['q1']);
  });

  it('preserves each kind’s order exactly — the edge’s oldest-first is not re-derived here', () => {
    const split = partitionApprovals([priceOverride('q2'), priceOverride('q1')]);
    expect(split.priceOverrides.map((p) => p.quoteId)).toEqual(['q2', 'q1']);
  });

  it('returns two empty sections for an empty inbox', () => {
    expect(partitionApprovals([])).toEqual({
      creditHolds: [],
      priceOverrides: [],
    });
  });
});

describe('orderKinds', () => {
  it('puts the one kind with an item first, the empty kinds after in the fixed order', () => {
    expect(orderKinds(partitionApprovals([creditHold('a1')]))).toEqual([
      'exceptions',
      'price-approvals',
    ]);
  });

  it('leads with the kind whose oldest item has waited longest', () => {
    const older = {
      ...creditHold('a1'),
      requestedAt: '2026-08-20T09:00:00.000Z',
    } as PendingApproval;
    expect(orderKinds(partitionApprovals([priceOverride('q1'), older]))).toEqual([
      'exceptions',
      'price-approvals',
    ]);
  });

  it('keeps the fixed order when nothing waits', () => {
    expect(orderKinds(partitionApprovals([]))).toEqual(['price-approvals', 'exceptions']);
  });
});

describe('approvalAskers', () => {
  it('names the requester of an exception and the rep of a price approval', () => {
    const priced = { ...priceOverride('q1'), salesRep: 'dev-sales-2' } as PendingApproval;
    expect(approvalAskers([creditHold('a1'), priced, priceOverride('q2')])).toEqual([
      'dev-sales',
      'dev-sales-2',
    ]);
  });
});

describe('approvalCustomerIds', () => {
  it('collects the customer of every kind', () => {
    const ids = approvalCustomerIds([creditHold('a1'), priceOverride('q1')]);
    expect(ids).toEqual(['0198c2e6-2222-7000-8000-000000000002', 'customer-b']);
  });
});

describe('handSetLines', () => {
  const line = (over: Record<string, unknown>) => ({ priceSource: 'tier', ...over }) as never;

  it('lists a line whose price was hand-set per ROLL', () => {
    expect(
      handSetLines([line({ priceSource: 'manual', overridePricePerRoll: '500.0000' }), line({})]),
    ).toHaveLength(1);
  });

  it('lists a line whose price was hand-set per POUND', () => {
    const typed = line({
      pricingBasis: 'per_pound',
      priceSource: 'manual',
      overridePricePerLb: '0.8350',
    });
    const derived = line({ pricingBasis: 'per_pound' });

    expect(handSetLines([typed, derived])).toEqual([typed]);
  });

  it('lists nothing on a quote the engine priced throughout', () => {
    expect(handSetLines([line({}), line({ pricingBasis: 'per_pound' })])).toEqual([]);
  });

  it('leaves out a margin entered manually, which needs no approval', () => {
    expect(handSetLines([line({ priceSource: 'margin', marginOverridePct: '0.270000' })])).toEqual(
      [],
    );
  });
});

describe('a quote waiting on the floor', () => {
  it('partitions a floor item with the price approvals, where the card is drawn', () => {
    const floor = { ...priceOverride('q-floor'), needs: ['floor'] } as PendingApproval;
    expect(partitionApprovals([floor]).priceOverrides.map((p) => p.quoteId)).toEqual(['q-floor']);
  });

  it('says what the card needs, from the edge’s needs', () => {
    expect(needsWords(['price'])).toBe('Needs: hand-set price');
    expect(needsWords(['floor'])).toBe('Needs: below the floor');
    expect(needsWords(['price', 'floor'])).toBe('Needs: hand-set price and below the floor');
  });

  it('lists the stored below-floor lines with their minimum, and says each', () => {
    const line = (lineNumber: number, floor: Record<string, unknown>) =>
      ({ lineNumber, floor }) as never;
    const below = belowFloorLines([
      line(1, { status: 'below_floor', minimumPricePerRoll: '13.8400' }),
      line(2, { status: 'ok' }),
    ]);
    expect(below).toEqual([{ lineNumber: 1, minimumPricePerRoll: '13.8400' }]);
    expect(below.map(belowFloorSentence)).toEqual(['Below the floor on line 1, minimum $13.84.']);
  });
});

describe('handSetReason', () => {
  const below = {
    status: 'below_floor',
    floorPct: '0.120000',
    minimumPricePerRoll: '13.8400',
  } as const;

  it('says a typed price per pound needs the Billing Manager, and that the floor is not why', () => {
    expect(
      handSetReason({ lineNumber: 1, pricingBasis: 'per_pound', floor: { status: 'ok' } }),
    ).toBe(
      "Line 1's price per pound was typed by hand. " +
        "Every hand-set price needs the Billing Manager's approval, whatever its margin. " +
        'Its margin meets the floor, so the floor is not why it needs approval.',
    );
  });

  it('names a typed price per roll on a per-roll line', () => {
    expect(
      handSetReason({ lineNumber: 3, pricingBasis: 'per_roll', floor: { status: 'ok' } }),
    ).toBe(
      "Line 3's price per roll was typed by hand. " +
        "Every hand-set price needs the Billing Manager's approval, whatever its margin. " +
        'Its margin meets the floor, so the floor is not why it needs approval.',
    );
  });

  it('says a line below the floor is a separate decision, an Admin overriding the floor', () => {
    expect(handSetReason({ lineNumber: 2, pricingBasis: 'per_roll', floor: below })).toBe(
      "Line 2's price per roll was typed by hand. " +
        "Every hand-set price needs the Billing Manager's approval, whatever its margin. " +
        'Its margin is below the floor, and overriding the floor is a separate decision for an Admin.',
    );
  });

  it('says the same of a per-pound line below the floor', () => {
    expect(handSetReason({ lineNumber: 1, pricingBasis: 'per_pound', floor: below })).toBe(
      "Line 1's price per pound was typed by hand. " +
        "Every hand-set price needs the Billing Manager's approval, whatever its margin. " +
        'Its margin is below the floor, and overriding the floor is a separate decision for an Admin.',
    );
  });
});

describe('enteredMarginSentence', () => {
  it('names the line and its margin, and says it is not part of the decision', () => {
    expect(enteredMarginSentence({ lineNumber: 2, marginOverridePct: '0.270000' })).toBe(
      'Line 2 has a margin entered manually, 27%, and is not part of this decision.',
    );
  });

  it('says nothing of a line with no margin entered', () => {
    expect(enteredMarginSentence({ lineNumber: 1 })).toBe('');
  });
});

describe('agreedPriceSentence and tierLineCount', () => {
  const ok = { status: 'ok' } as const;

  it('names the line and says it needs no approval', () => {
    expect(agreedPriceSentence({ lineNumber: 1 })).toBe(
      'Line 1 is at the customer’s agreed price and needs no approval.',
    );
  });

  it('counts only the lines at tier, above the floor', () => {
    const lines = [
      { priceSource: 'agreed', floor: ok },
      { priceSource: 'manual', floor: ok },
      { priceSource: 'margin', marginOverridePct: '0.270000', floor: ok },
      { priceSource: 'tier', floor: ok },
      { priceSource: 'tier', floor: { status: 'below_floor' } },
    ] as unknown as Parameters<typeof tierLineCount>[0];
    expect(tierLineCount(lines)).toBe(1);
  });
});
