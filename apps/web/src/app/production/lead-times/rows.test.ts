// Tests the lead-time queue: the reads, the merge and order, and the row words.
import type { QuoteListItem } from '@erp/types';
import { describe, expect, it } from 'vitest';

import { leadTimeHref, leadTimeQueue, leadTimeQueueQueries, linesLabel, toldLabel } from './rows';

function quote(id: string, updatedAt: string, over: Partial<QuoteListItem> = {}): QuoteListItem {
  return {
    id,
    customerId: 'customer-1',
    status: 'draft',
    rootQuoteId: id,
    versionNumber: 1,
    quoteNumber: 1,
    lockVersion: 1,
    freightInRollPrice: false,
    createdAt: '2026-10-01T16:00:00.000Z',
    updatedAt,
    lineCount: 0,
    belowFloorCount: 0,
    manualCount: 0,
    manualPricePerRoll: null,
    ...over,
  };
}

describe('leadTimeQueueQueries', () => {
  it('reads the drafts and the quotes waiting on a price approval, each without a lead time', () => {
    expect(leadTimeQueueQueries()).toEqual([
      'status=draft&leadTime=missing',
      'status=override_requested&leadTime=missing',
    ]);
  });
});

describe('leadTimeQueue', () => {
  it('merges the two reads oldest first, by the last change', () => {
    const drafts = [quote('a', '2026-10-06T16:00:00.000Z'), quote('b', '2026-09-28T16:00:00.000Z')];
    const asked = [quote('c', '2026-10-01T16:00:00.000Z', { status: 'override_requested' })];

    expect(leadTimeQueue([drafts, asked]).map((q) => q.id)).toEqual(['b', 'c', 'a']);
  });

  it('lists a quote once when a status change lands it in both reads', () => {
    const first = quote('a', '2026-10-06T16:00:00.000Z');
    const moved = quote('a', '2026-10-06T16:00:00.000Z', { status: 'override_requested' });

    expect(leadTimeQueue([[first], [moved]])).toHaveLength(1);
  });

  it('is empty when nothing waits', () => {
    expect(leadTimeQueue([[], []])).toEqual([]);
  });
});

describe('linesLabel', () => {
  it('says how far Sales has got', () => {
    expect(linesLabel(0)).toBe('no lines yet');
    expect(linesLabel(1)).toBe('1 priced');
    expect(linesLabel(2)).toBe('2 priced');
  });
});

describe('toldLabel', () => {
  const day = (iso: string) => iso.slice(0, 10);

  it('names the day Production was asked', () => {
    expect(toldLabel('2026-10-07T17:00:00.000Z', day)).toBe('2026-10-07');
  });

  it('is blank when no request went', () => {
    expect(toldLabel(null, day)).toBe('');
    expect(toldLabel(undefined, day)).toBe('');
  });
});

describe('leadTimeHref', () => {
  it('opens the quote at its lead-time form', () => {
    expect(leadTimeHref('01988a00-0100-7000-8000-000000000001')).toBe(
      '/quoting/quotes/01988a00-0100-7000-8000-000000000001#lead-time',
    );
  });
});
