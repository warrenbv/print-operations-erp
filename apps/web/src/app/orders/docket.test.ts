// Tests the Orders list: the filter, the query, the sorts and the rows.
import { ORDER_STATUSES, type Order } from '@erp/types';
import { describe, expect, it } from 'vitest';

import type { Work } from '../../lib/work/work';

import {
  buildOrderQuery,
  chipTone,
  docketRows,
  filterValue,
  parseFilter,
  sortDocket,
} from './docket';

function order(over: Partial<Order> = {}): Order {
  return {
    id: '01a00000-0000-7000-8000-000000000001',
    quoteId: 'q1',
    customerId: 'c1',
    status: 'confirmed',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...over,
  } as Order;
}

describe('parseFilter', () => {
  it('defaults to every order', () => {
    expect(parseFilter(undefined)).toEqual({ kind: 'all' });
    expect(parseFilter('all')).toEqual({ kind: 'all' });
  });

  it('takes a single real status', () => {
    expect(parseFilter('confirmed')).toEqual({ kind: 'status', status: 'confirmed' });
  });

  it('falls back to every order on a value it does not recognise', () => {
    expect(parseFilter('nonsense')).toEqual({ kind: 'all' });
  });

  it('round-trips every status and the default through the URL and back', () => {
    for (const status of ORDER_STATUSES) {
      const filter = { kind: 'status', status } as const;
      expect(parseFilter(filterValue(filter)), status).toEqual(filter);
    }
    expect(parseFilter(filterValue({ kind: 'all' }))).toEqual({ kind: 'all' });
  });
});

describe('buildOrderQuery', () => {
  it('asks for every order with no status parameter', () => {
    expect(buildOrderQuery({ kind: 'all' })).toBe('');
  });

  it('sends an explicit status', () => {
    expect(buildOrderQuery({ kind: 'status', status: 'converted' })).toBe('status=converted');
  });

  it('carries the rep beside a single status and beside every order', () => {
    expect(buildOrderQuery({ kind: 'status', status: 'confirmed' }, 'demo-sales-a')).toBe(
      'status=confirmed&salesRep=demo-sales-a',
    );
    expect(buildOrderQuery({ kind: 'all' }, 'demo-sales-a')).toBe('salesRep=demo-sales-a');
  });

  it('sends no rep parameter at all for every rep', () => {
    expect(buildOrderQuery({ kind: 'all' })).not.toContain('salesRep');
    expect(buildOrderQuery({ kind: 'all' }, undefined)).not.toContain('salesRep');
  });

  it('encodes a rep value that was typed rather than picked', () => {
    expect(buildOrderQuery({ kind: 'all' }, 'Demo, Casey')).toContain('salesRep=Demo%2C+Casey');
  });
});

describe('sortDocket', () => {
  const names = new Map([
    ['c1', 'Zeta Demo Paper'],
    ['c2', 'Example Customer Print'],
  ]);

  it('puts the longest-waiting job first, unlike the quote list', () => {
    const older = order({ id: 'a', requestedDate: '2026-08-01' });
    const newer = order({ id: 'b', requestedDate: '2026-09-01' });
    expect(sortDocket([newer, older], 'requested', names).map((o) => o.id)).toEqual(['a', 'b']);
  });

  it('sorts a row with no requested date LAST, not first', () => {
    const dated = order({ id: 'a', requestedDate: '2026-09-01' });
    const undatedRow = order({ id: 'b' });
    expect(sortDocket([undatedRow, dated], 'requested', names).map((o) => o.id)).toEqual([
      'a',
      'b',
    ]);
  });

  it('sorts an unminted job number last too', () => {
    const minted = order({ id: 'a', jobNumber: 'J-1000' });
    const unminted = order({ id: 'b' });
    expect(sortDocket([unminted, minted], 'job', names).map((o) => o.id)).toEqual(['a', 'b']);
  });

  it('sorts by the customer NAME shown, not the id', () => {
    const zeta = order({ id: 'a', customerId: 'c1' });
    const acme = order({ id: 'b', customerId: 'c2' });
    expect(sortDocket([zeta, acme], 'customer', names).map((o) => o.id)).toEqual(['b', 'a']);
  });

  it('sorts status by lifecycle position, not alphabetically', () => {
    const confirmed = order({ id: 'a', status: 'confirmed' });
    const converted = order({ id: 'b', status: 'converted' });
    expect(sortDocket([confirmed, converted], 'status', names).map((o) => o.id)).toEqual([
      'b',
      'a',
    ]);
  });

  it('breaks ties on creation, oldest first', () => {
    const first = order({ id: 'a', status: 'confirmed', createdAt: '2026-08-01T00:00:00.000Z' });
    const second = order({ id: 'b', status: 'confirmed', createdAt: '2026-08-02T00:00:00.000Z' });
    expect(sortDocket([second, first], 'status', names).map((o) => o.id)).toEqual(['a', 'b']);
  });

  it('does not mutate the array it was given', () => {
    const rows = [
      order({ id: 'b', requestedDate: '2026-09-01' }),
      order({ id: 'a', requestedDate: '2026-08-01' }),
    ];
    sortDocket(rows, 'requested', names);
    expect(rows.map((o) => o.id)).toEqual(['b', 'a']);
  });
});

function work(over: Partial<Work> = {}): Work {
  return {
    group: 'another-desk',
    next: 'Confirm the order',
    with: 'The Production Manager',
    desk: 'The Production Manager',
    ageFrom: '2026-08-01T18:00:00.000Z',
    href: '/orders/x',
    ...over,
  };
}

describe('chipTone', () => {
  it('is now when the next act is the reader’s', () => {
    expect(chipTone(work({ group: 'yours', with: 'You' }))).toBe('now');
  });

  it('is pending when the act is another desk’s', () => {
    expect(chipTone(work())).toBe('pending');
  });

  it('is done for a settled order', () => {
    expect(chipTone(work({ group: 'done', next: null, with: null }))).toBe('done');
  });

  it('is pending when the work read missed the order', () => {
    expect(chipTone(undefined)).toBe('pending');
  });
});

describe('docketRows', () => {
  const now = new Date('2026-08-12T18:00:00.000Z');
  const converted = order({ id: 'o1', quoteId: 'q1', status: 'converted' });
  const job = order({ id: 'o2', quoteId: 'q2', status: 'confirmed', jobNumber: 'DPW-00573' });
  const input = {
    work: new Map<string, Work>([
      [
        'o1',
        work({
          group: 'yours',
          next: 'Confirm the order',
          with: 'You',
          ageFrom: '2026-08-11T18:00:00.000Z',
        }),
      ],
      [
        'o2',
        work({
          group: 'done',
          next: null,
          with: null,
          desk: null,
          ageFrom: '2026-08-01T18:00:00.000Z',
        }),
      ],
    ]),
    customerNames: new Map([['c1', 'Northstar Demo Packaging']]),
    quoteRefs: new Map([['q1', 'Q-00084']]),
    now,
  };

  it('reads Next and With from the work, in the order given', () => {
    const rows = docketRows([converted, job], input);
    expect(rows.map((row) => [row.name, row.next, row.with])).toEqual([
      ['Order from Q-00084', 'Confirm the order', 'You'],
      ['DPW-00573', null, null],
    ]);
  });

  it('names the customer, the status label and the tone', () => {
    const [first, second] = docketRows([converted, job], input);
    expect(first).toMatchObject({
      customer: 'Northstar Demo Packaging',
      status: 'Converted',
      tone: 'now',
      href: '/orders/o1',
    });
    expect(second?.tone).toBe('done');
  });

  it('says the wait in days and marks it late past seven', () => {
    const [first, second] = docketRows([converted, job], input);
    expect(first).toMatchObject({ waiting: '1 day', late: false });
    expect(second).toMatchObject({ waiting: '11 days', late: true });
  });

  it('leaves Next and With empty for an order the work read missed, aged from its own change', () => {
    const missed = order({ id: 'o3', updatedAt: '2026-08-12T17:00:00.000Z' });
    const [row] = docketRows([missed], input);
    expect(row).toMatchObject({ next: null, with: null, waiting: 'today', tone: 'pending' });
  });
});
