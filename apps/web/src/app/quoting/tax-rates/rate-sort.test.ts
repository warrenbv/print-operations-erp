// Tests reading the sort parameter, sorting the rates, the header links and the sentence that names the order.
import type { TaxRateSummary } from '@erp/types';
import { describe, expect, it } from 'vitest';

import {
  resolveTaxRateSort,
  sortHeaders,
  sortSentence,
  sortTaxRates,
  TAX_RATE_SORT_COLUMNS,
  TAX_RATE_SORT_TOKENS,
  type TaxRateSort,
} from './rate-sort';

const BASE_PATH = '/quoting/tax-rates';

function row(fields: Partial<TaxRateSummary> & { jurisdiction: string }): TaxRateSummary {
  return {
    id: `id-${fields.jurisdiction}`,
    rate: '0.080000',
    effectiveFrom: '2026-07-01',
    source: 'wa_dor',
    stale: false,
    createdAt: '2026-07-01T12:00:00.000Z',
    ...fields,
  };
}

const CLARKSTON = row({ jurisdiction: 'WA-0202', name: 'CLARKSTON', rate: '0.085000' });
const WHITMAN = row({ jurisdiction: 'WA-3800', name: 'WHITMAN COUNTY', rate: '0.080000' });
const IDAHO = row({
  jurisdiction: 'ID',
  rate: '0.060000',
  effectiveFrom: '2001-01-01',
  source: 'statute',
});

const codesOf = (rows: readonly TaxRateSummary[]): string[] => rows.map((r) => r.jurisdiction);

const sortBy = (rows: readonly TaxRateSummary[], sort: string | undefined): string[] =>
  codesOf(sortTaxRates(rows, resolveTaxRateSort(sort)));

describe('resolveTaxRateSort', () => {
  it('sorts by the city name, A to Z, when nothing is asked for', () => {
    const sort = resolveTaxRateSort(undefined);
    expect(sort).toEqual({ column: 'name', direction: 'asc' });
  });

  it('honours a column and a direction', () => {
    expect(resolveTaxRateSort('rate')).toEqual({ column: 'rate', direction: 'asc' });
    expect(resolveTaxRateSort('effective-desc')).toEqual({
      column: 'effective',
      direction: 'desc',
    });
  });

  it('quotes back a sort this table does not have', () => {
    const sort = resolveTaxRateSort('city');
    expect(sort.column).toBe('name');
    expect(sort.direction).toBe('asc');
    expect(sort.rejected).toBe('city');
  });

  it('rejects a direction the table does not offer', () => {
    expect(resolveTaxRateSort('rate-asc').rejected).toBe('rate-asc');
  });

  it('rejects an empty string rather than treating it as absent', () => {
    expect(resolveTaxRateSort('').rejected).toBe('');
  });

  it('resolves every token it publishes to a real column', () => {
    expect(TAX_RATE_SORT_TOKENS).toHaveLength(TAX_RATE_SORT_COLUMNS.length * 2);
    for (const token of TAX_RATE_SORT_TOKENS) {
      const sort = resolveTaxRateSort(token);
      expect(sort.rejected).toBeUndefined();
      expect(TAX_RATE_SORT_COLUMNS).toContain(sort.column);
    }
  });
});

describe('sortTaxRates', () => {
  const rows = [IDAHO, CLARKSTON, WHITMAN];

  it('orders by city name, and puts a row with no name last', () => {
    expect(sortBy(rows, undefined)).toEqual(['WA-0202', 'WA-3800', 'ID']);
  });

  it('keeps a row with no name last when the name order is reversed', () => {
    expect(sortBy(rows, 'name-desc')).toEqual(['WA-3800', 'WA-0202', 'ID']);
  });

  it('orders by rate as a number', () => {
    expect(sortBy(rows, 'rate')).toEqual(['ID', 'WA-3800', 'WA-0202']);
    expect(sortBy(rows, 'rate-desc')).toEqual(['WA-0202', 'WA-3800', 'ID']);
  });

  it('treats two spellings of the same rate as equal', () => {
    const typed = row({ jurisdiction: 'WA-9002', name: 'TYPED', rate: '0.065' });
    const imported = row({ jurisdiction: 'WA-9001', name: 'IMPORTED', rate: '0.065000' });
    expect(sortBy([typed, imported], 'rate')).toEqual(['WA-9001', 'WA-9002']);
  });

  it('orders by effective date, earliest first', () => {
    expect(sortBy(rows, 'effective')).toEqual(['ID', 'WA-0202', 'WA-3800']);
    expect(sortBy(rows, 'effective-desc')).toEqual(['WA-0202', 'WA-3800', 'ID']);
  });

  it('orders standing by the flag, stale first', () => {
    const stale = row({ jurisdiction: 'WA-1000', name: 'STALE CITY', stale: true });
    expect(sortBy([CLARKSTON, stale], 'standing')).toEqual(['WA-1000', 'WA-0202']);
    expect(sortBy([stale, CLARKSTON], 'standing-desc')).toEqual(['WA-0202', 'WA-1000']);
  });

  it('breaks a tie on the jurisdiction code, the same way in both directions', () => {
    const later = row({ jurisdiction: 'WA-0500', name: 'SAME', rate: '0.080000' });
    const earlier = row({ jurisdiction: 'WA-0100', name: 'SAME', rate: '0.080000' });
    expect(sortBy([later, earlier], 'name')).toEqual(['WA-0100', 'WA-0500']);
    expect(sortBy([later, earlier], 'name-desc')).toEqual(['WA-0100', 'WA-0500']);
  });

  it('leaves the list it was given alone', () => {
    const given = [IDAHO, CLARKSTON, WHITMAN];
    sortTaxRates(given, resolveTaxRateSort('rate-desc'));
    expect(codesOf(given)).toEqual(['ID', 'WA-0202', 'WA-3800']);
  });
});

describe('sortHeaders', () => {
  const headersFor = (sort: TaxRateSort) => sortHeaders(BASE_PATH, sort);

  it('offers every column, in the order they are rendered', () => {
    const headers = headersFor(resolveTaxRateSort(undefined));
    expect(headers.map((header) => header.column)).toEqual([...TAX_RATE_SORT_COLUMNS]);
    expect(headers.map((header) => header.label)).toEqual([
      'Jurisdiction',
      'Name',
      'Rate',
      'Effective from',
      'Source',
      'Standing',
    ]);
  });

  it('starts an unsorted column ascending', () => {
    const headers = headersFor(resolveTaxRateSort(undefined));
    const rate = headers.find((header) => header.column === 'rate');
    expect(rate?.href).toBe('/quoting/tax-rates?sort=rate');
    expect(rate?.direction).toBeUndefined();
  });

  it('reverses the column already sorted, then returns it', () => {
    const ascending = headersFor(resolveTaxRateSort('rate')).find((h) => h.column === 'rate');
    expect(ascending?.direction).toBe('asc');
    expect(ascending?.href).toBe('/quoting/tax-rates?sort=rate-desc');

    const descending = headersFor(resolveTaxRateSort('rate-desc')).find((h) => h.column === 'rate');
    expect(descending?.direction).toBe('desc');
    expect(descending?.href).toBe('/quoting/tax-rates?sort=rate');
  });

  it('marks exactly one column as the one being sorted by', () => {
    const marked = headersFor(resolveTaxRateSort('source-desc')).filter(
      (header) => header.direction !== undefined,
    );
    expect(marked.map((header) => header.column)).toEqual(['source']);
  });
});

describe('sortSentence', () => {
  it('names the column and the direction in words', () => {
    expect(sortSentence(resolveTaxRateSort(undefined))).toBe('Sorted by Name, A to Z.');
    expect(sortSentence(resolveTaxRateSort('rate'))).toBe('Sorted by Rate, lowest first.');
    expect(sortSentence(resolveTaxRateSort('rate-desc'))).toBe('Sorted by Rate, highest first.');
    expect(sortSentence(resolveTaxRateSort('effective'))).toBe(
      'Sorted by Effective from, earliest first.',
    );
    expect(sortSentence(resolveTaxRateSort('standing'))).toBe('Sorted by Standing, stale first.');
  });

  it('says there is no such sort, and which one it used instead', () => {
    expect(sortSentence(resolveTaxRateSort('city'))).toBe(
      'There is no sort called "city", so the table is sorted by Name, A to Z.',
    );
  });
});
