// Tests the sales rep filter: parsing, options, and the reader's default.
import type { ResolvedSalesRep, SalesRep } from '@erp/types';
import { describe, expect, it } from 'vitest';

import {
  defaultRep,
  NO_REP,
  parseRepFilter,
  REP_FILTER_ANY,
  REP_FILTER_ANY_LABEL,
  repFilterOptions,
} from './rep-filter';

const OFFERABLE: readonly SalesRep[] = [
  { username: 'demo-sales-a', displayName: 'Jamie Demo' },
  { username: 'demo-sales-b', displayName: 'Blair Demo' },
];

describe('parseRepFilter', () => {
  it('reads a rep from the URL', () => {
    expect(parseRepFilter('demo-sales-a')).toBe('demo-sales-a');
  });

  it('means every rep when the param is absent', () => {
    expect(parseRepFilter(undefined)).toBeUndefined();
  });

  it('means every rep when the param is empty or blank', () => {
    expect(parseRepFilter('')).toBeUndefined();
    expect(parseRepFilter('   ')).toBeUndefined();
  });

  it('keeps a value no current rep holds, so an old spelling still filters', () => {
    expect(parseRepFilter('Demo, Casey')).toBe('Demo, Casey');
  });

  it('trims, so a padded URL matches the stored value', () => {
    expect(parseRepFilter(' demo-sales-a ')).toBe('demo-sales-a');
  });
});

describe('repFilterOptions', () => {
  it('leads with every rep, then the current holders', () => {
    expect(repFilterOptions(OFFERABLE, undefined)).toEqual([
      { value: REP_FILTER_ANY, label: REP_FILTER_ANY_LABEL },
      { value: 'demo-sales-a', label: 'Jamie Demo' },
      { value: 'demo-sales-b', label: 'Blair Demo' },
    ]);
  });

  it('does not repeat a selected rep who still holds Sales', () => {
    const selected: ResolvedSalesRep = {
      username: 'demo-sales-a',
      displayName: 'Jamie Demo',
      offerable: true,
    };
    expect(repFilterOptions(OFFERABLE, selected)).toHaveLength(3);
  });

  it('keeps a selected rep who has left Sales in the list, by name', () => {
    const selected: ResolvedSalesRep = {
      username: 'demo-sales-c',
      displayName: 'Casey Demo',
      offerable: false,
    };
    expect(repFilterOptions(OFFERABLE, selected).at(-1)).toEqual({
      value: 'demo-sales-c',
      label: 'Casey Demo (no longer in sales)',
    });
  });

  it('keeps a selected free-text value, marked as stored', () => {
    const selected: ResolvedSalesRep = { username: 'Demo, Casey', offerable: false };
    expect(repFilterOptions(OFFERABLE, selected).at(-1)).toEqual({
      value: 'Demo, Casey',
      label: 'Demo, Casey (as stored)',
    });
  });

  it('offers only the clear option when nobody holds Sales', () => {
    expect(repFilterOptions([], undefined)).toEqual([
      { value: REP_FILTER_ANY, label: REP_FILTER_ANY_LABEL },
    ]);
  });
});

describe('NO_REP', () => {
  it('says the absence out loud rather than leaving a blank cell', () => {
    expect(NO_REP).toBe('no rep');
  });
});

describe('defaultRep', () => {
  const reps: readonly SalesRep[] = [
    { username: 'demo-sales-d', displayName: 'Avery Demo' },
    { username: 'demo-sales-e', displayName: 'Riley Demo' },
  ];

  it('is the reader when the reader is a rep anyone may pick', () => {
    expect(defaultRep({ username: 'demo-sales-e' }, reps)).toBe('demo-sales-e');
  });

  it('is every rep for a reader nobody may pick', () => {
    expect(defaultRep({ username: 'dev-billing' }, reps)).toBeUndefined();
  });

  it('is every rep when there are no reps at all', () => {
    expect(defaultRep({ username: 'demo-sales-d' }, [])).toBeUndefined();
  });
});
