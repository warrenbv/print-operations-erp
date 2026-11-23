// Tests rep resolution, the rep options and the batching of name lookups.
import { SALES_REP_RESOLVE_MAX_NAMES, type ResolvedSalesRep, type SalesRep } from '@erp/types';
import { describe, expect, it } from 'vitest';

import { repOptions, resolveBatches, resolveFromOfferable } from './sales-reps';

const OFFERABLE: readonly SalesRep[] = [
  { username: 'demo-sales-a', displayName: 'Jamie Demo' },
  { username: 'demo-sales-b', displayName: 'Blair Demo' },
];

describe('resolveFromOfferable', () => {
  it('names a rep who still holds Sales', () => {
    expect(resolveFromOfferable('demo-sales-a', OFFERABLE)).toEqual({
      username: 'demo-sales-a',
      displayName: 'Jamie Demo',
      offerable: true,
    });
  });

  it('reports no display name for a value the offerable list does not carry', () => {
    expect(resolveFromOfferable('demo-sales-c', OFFERABLE)).toEqual({
      username: 'demo-sales-c',
      offerable: false,
    });
  });
});

describe('repOptions', () => {
  it('offers every current holder', () => {
    expect(repOptions(OFFERABLE, undefined)).toEqual([
      { value: 'demo-sales-a', label: 'Jamie Demo' },
      { value: 'demo-sales-b', label: 'Blair Demo' },
    ]);
  });

  it('does not repeat a stored rep who is still offerable', () => {
    const stored: ResolvedSalesRep = {
      username: 'demo-sales-a',
      displayName: 'Jamie Demo',
      offerable: true,
    };
    expect(repOptions(OFFERABLE, stored)).toHaveLength(2);
  });

  it('keeps a departed rep in the list, by name, so saving the form cannot drop them', () => {
    const stored: ResolvedSalesRep = {
      username: 'demo-sales-c',
      displayName: 'Casey Demo',
      offerable: false,
    };
    expect(repOptions(OFFERABLE, stored)).toEqual([
      { value: 'demo-sales-a', label: 'Jamie Demo' },
      { value: 'demo-sales-b', label: 'Blair Demo' },
      { value: 'demo-sales-c', label: 'Casey Demo (no longer in sales)' },
    ]);
  });

  it('marks an unresolvable value as stored rather than claiming it named a user', () => {
    const stored: ResolvedSalesRep = { username: 'Taylor from Example Customer', offerable: false };
    expect(repOptions(OFFERABLE, stored)[2]).toEqual({
      value: 'Taylor from Example Customer',
      label: 'Taylor from Example Customer (as stored)',
    });
  });
});

describe('resolveBatches', () => {
  const names = (count: number): string[] => Array.from({ length: count }, (_, i) => `rep-${i}`);

  it('asks about nothing when there is nothing to resolve', () => {
    expect(resolveBatches([])).toEqual([]);
  });

  it('deduplicates, so a list of rows costs one name per rep', () => {
    expect(resolveBatches(['demo-sales-a', 'demo-sales-a', 'demo-sales-b'])).toEqual([
      ['demo-sales-a', 'demo-sales-b'],
    ]);
  });

  it('fits the route cap in one request', () => {
    const batches = resolveBatches(names(SALES_REP_RESOLVE_MAX_NAMES));
    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(SALES_REP_RESOLVE_MAX_NAMES);
  });

  it('splits one past the cap into two requests rather than taking a 400', () => {
    const batches = resolveBatches(names(SALES_REP_RESOLVE_MAX_NAMES + 1));
    expect(batches.map((batch) => batch.length)).toEqual([SALES_REP_RESOLVE_MAX_NAMES, 1]);
    expect(batches.flat()).toHaveLength(SALES_REP_RESOLVE_MAX_NAMES + 1);
  });
});
