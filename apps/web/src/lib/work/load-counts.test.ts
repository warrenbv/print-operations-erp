// Tests the nav counts per group and that a failed read shows bare labels.
import type { SessionUser } from '@erp/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LEAD_TIMES_HREF, ORDERS_HREF, QUOTES_HREF } from '../../app/nav/nav-map';
import { fetchParsed } from '../fetch-parsed';
import { loadNavCounts, productionCounts, quotesCount, salesCounts } from './load-counts';
import { loadWorkbook, type Workbook } from './load-workbook';
import type { Work, WorkGroup } from './work';

vi.mock('../fetch-parsed', () => ({ fetchParsed: vi.fn() }));
vi.mock('./load-workbook', () => ({ loadWorkbook: vi.fn() }));

function work(group: WorkGroup, next: string | null): Work {
  return {
    group,
    next,
    with: group === 'yours' ? 'You' : 'Sales',
    desk: 'Sales',
    ageFrom: '',
    href: '/',
  };
}

function book(entries: { quotes?: Work[]; orders?: Work[] }): Workbook {
  return {
    quotes: (entries.quotes ?? []).map((w) => ({ quote: {}, work: w })),
    orders: (entries.orders ?? []).map((w) => ({ order: {}, work: w })),
  } as unknown as Workbook;
}

const me = { username: 'dev-sales', roles: ['Sales'] } as unknown as SessionUser;

describe('the derived counts', () => {
  it('counts the quotes in the Your move group, and only those', () => {
    const wb = book({
      quotes: [
        work('yours', 'Send the quote'),
        work('yours', 'Enter the lead time'),
        work('another-desk', 'Approve the price'),
        work('customer', 'Accept the quote'),
        work('converted', null),
      ],
    });
    expect(quotesCount(wb)).toBe(2);
    expect(salesCounts(wb)).toEqual({ [QUOTES_HREF]: 2 });
  });
});

describe('the production counts', () => {
  it('sums the two lead-time reads into the one Needs a lead time count', () => {
    expect(productionCounts({ toConfirm: 3, leadTimeDraft: 2, leadTimeOverride: 1 })).toEqual({
      [ORDERS_HREF]: 3,
      [LEAD_TIMES_HREF]: 3,
    });
  });
});

describe('loadNavCounts', () => {
  const fetchMock = vi.mocked(fetchParsed);
  const workbookMock = vi.mocked(loadWorkbook);

  beforeEach(() => {
    fetchMock.mockReset();
    workbookMock.mockReset();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  it('reads nothing for a group with no queue', async () => {
    for (const group of ['home', 'approvals', 'billing', 'admin', undefined]) {
      expect(await loadNavCounts(me, group)).toEqual({});
    }
    expect(fetchMock).not.toHaveBeenCalled();
    expect(workbookMock).not.toHaveBeenCalled();
  });

  it('answers Production from three count reads and no workbook', async () => {
    const answers: Record<string, number> = {
      '/orders?status=converted&count=true': 3,
      '/quoting/quotes?status=draft&leadTime=missing&count=true': 2,
      '/quoting/quotes?status=override_requested&leadTime=missing&count=true': 1,
    };
    fetchMock.mockImplementation((path: string) =>
      Promise.resolve({ count: answers[path], oldest: null }),
    );

    expect(await loadNavCounts(me, 'production')).toEqual({
      [ORDERS_HREF]: 3,
      [LEAD_TIMES_HREF]: 3,
    });
    expect(fetchMock.mock.calls.map(([path]) => path).sort()).toEqual(Object.keys(answers).sort());
    expect(workbookMock).not.toHaveBeenCalled();
  });

  it('answers Sales from the workbook alone', async () => {
    workbookMock.mockResolvedValue(book({ quotes: [work('yours', 'Send the quote')] }));

    expect(await loadNavCounts(me, 'sales')).toEqual({ [QUOTES_HREF]: 1 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('answers none when a read fails, so the row draws bare labels', async () => {
    fetchMock.mockRejectedValue(new Error('/orders responded 500'));
    workbookMock.mockRejectedValue(new Error('NEXT_REDIRECT'));

    expect(await loadNavCounts(me, 'production')).toEqual({});
    expect(await loadNavCounts(me, 'sales')).toEqual({});
  });
});
