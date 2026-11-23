// Tests paging from the query string, the rows line and the page links.
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  hasNextPage,
  hasPreviousPage,
  pageHref,
  resolvePaging,
  showingLine,
} from './paging';

const TOTAL = 33;

describe('resolvePaging', () => {
  it('defaults to the first page at the API default size', () => {
    expect(resolvePaging({})).toEqual({ page: 1, size: DEFAULT_PAGE_SIZE, offset: 0 });
  });

  it('turns a page number into the offset the API takes', () => {
    expect(resolvePaging({ page: '2' }).offset).toBe(20);
    expect(resolvePaging({ page: '3', size: '10' }).offset).toBe(20);
  });

  it('falls back to page one on anything unusable', () => {
    for (const page of ['0', '-1', 'abc', '', '6.5', ' ']) {
      expect(resolvePaging({ page }).page, JSON.stringify(page)).toBe(1);
    }
  });

  it('caps the size at what the search will actually answer', () => {
    expect(resolvePaging({ size: '3200' }).size).toBe(MAX_PAGE_SIZE);
    expect(resolvePaging({ size: '50' }).size).toBe(50);
  });
});

describe('showingLine', () => {
  it('says which slice is on screen, in the API figures', () => {
    expect(showingLine(resolvePaging({}), TOTAL, 20)).toBe('Showing 1 to 20 of 33.');
    expect(showingLine(resolvePaging({ page: '2' }), TOTAL, 13)).toBe('Showing 21 to 33 of 33.');
  });

  it('counts the rows actually returned, not the page size', () => {
    expect(showingLine(resolvePaging({ page: '2' }), TOTAL, 13)).toContain('to 33');
  });

  it('says so when the URL asks for a page past the end', () => {
    expect(showingLine(resolvePaging({ page: '9' }), TOTAL, 0)).toBe(
      'No rows on page 9. 33 in total.',
    );
  });

  it('answers null when there is nothing to place', () => {
    expect(showingLine(resolvePaging({}), 0, 0)).toBeNull();
  });
});

describe('which page links are offered', () => {
  it('offers Next while rows remain and Previous once past the first page', () => {
    const first = resolvePaging({});
    expect(hasPreviousPage(first)).toBe(false);
    expect(hasNextPage(first, TOTAL)).toBe(true);

    const second = resolvePaging({ page: '2' });
    expect(hasPreviousPage(second)).toBe(true);
    expect(hasNextPage(second, TOTAL)).toBe(false);
  });

  it('offers neither when one page holds everything', () => {
    const only = resolvePaging({});
    expect(hasPreviousPage(only)).toBe(false);
    expect(hasNextPage(only, 20)).toBe(false);
  });
});

describe('pageHref', () => {
  it('keeps the search text, which is the one that must survive', () => {
    expect(pageHref('/crm/customers', { q: 'ridge' }, 2)).toBe('/crm/customers?q=ridge&page=2');
  });

  it('leaves page 1 bare, so the shortest URL is the one people copy', () => {
    expect(pageHref('/crm/customers', { q: 'ridge' }, 1)).toBe('/crm/customers?q=ridge');
    expect(pageHref('/crm/customers', {}, 1)).toBe('/crm/customers');
  });

  it('drops empty and absent parameters rather than writing them out', () => {
    expect(pageHref('/quoting/quotes/new', { q: '', size: undefined }, 3)).toBe(
      '/quoting/quotes/new?page=3',
    );
  });

  it('carries a chosen page size across pages', () => {
    expect(pageHref('/crm/customers', { q: '', size: '50' }, 2)).toBe(
      '/crm/customers?size=50&page=2',
    );
  });

  it('pages a second list on its own parameter, carrying the first one', () => {
    expect(pageHref('/crm/customers/c-1', { page: '3', size: '10' }, 2, 'hpage')).toBe(
      '/crm/customers/c-1?page=3&size=10&hpage=2',
    );
    expect(pageHref('/crm/customers/c-1', { page: '3' }, 1, 'hpage')).toBe(
      '/crm/customers/c-1?page=3',
    );
  });

  it('encodes what a person typed', () => {
    expect(pageHref('/crm/customers', { q: 'a&b c' }, 2)).toBe('/crm/customers?q=a%26b+c&page=2');
  });
});
