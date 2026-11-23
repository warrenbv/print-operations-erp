// Tests what an order is called, the order a quote lists its orders in, and which quotes are read to name them.
import { describe, expect, it } from 'vitest';

import { byDeliveryDate, orderName } from './format';
import { quoteIdsToName } from './quote-references';

const ID = '01a02569-c8c1-702e-8f21-4b6d9c0e5a77';

describe('what an order is called', () => {
  it('uses the job number once confirmation has minted it', () => {
    expect(orderName({ id: ID, jobNumber: 'J-2759' }, 'Q-00091')).toBe('Order J-2759');
  });

  it('names an unconfirmed order by its quote, the wording of the alert', () => {
    expect(orderName({ id: ID, jobNumber: undefined }, 'Q-00091')).toBe('Order from Q-00091');
    expect(orderName({ id: ID }, 'Q-00091 v2')).toBe('Order from Q-00091 v2');
  });

  it('falls back to the id tail only when the quote did not resolve', () => {
    expect(orderName({ id: ID }, null)).toBe('Order 9c0e5a77');
    expect(orderName({ id: ID }, undefined)).toBe('Order 9c0e5a77');
  });
});

describe('the order a quote lists its orders in', () => {
  const order = (id: string, createdAt: string, requestedDate?: string) => ({
    id,
    createdAt: `${createdAt}T17:00:00.000Z`,
    ...(requestedDate === undefined ? {} : { requestedDate }),
  });

  it('runs by delivery date, soonest first, then the undated ones newest first', () => {
    const rows = [
      order('undated-old', '2026-11-01'),
      order('july', '2026-11-02', '2027-07-15'),
      order('undated-new', '2026-11-05'),
      order('june', '2026-11-03', '2027-06-10'),
    ];
    expect([...rows].sort(byDeliveryDate).map((row) => row.id)).toEqual([
      'june',
      'july',
      'undated-new',
      'undated-old',
    ]);
  });

  it('puts the newer order first when two share a delivery date', () => {
    const rows = [
      order('older', '2026-11-01', '2027-06-10'),
      order('newer', '2026-11-02', '2027-06-10'),
    ];
    expect([...rows].sort(byDeliveryDate).map((row) => row.id)).toEqual(['newer', 'older']);
  });
});

describe('which quotes a list reads to name its orders', () => {
  it('reads only the quotes of orders with no job number, once each', () => {
    expect(
      quoteIdsToName([
        { quoteId: 'q-1', jobNumber: 'J-1' },
        { quoteId: 'q-2' },
        { quoteId: 'q-2' },
        { quoteId: 'q-3', jobNumber: undefined },
      ]),
    ).toEqual(['q-2', 'q-3']);
  });

  it('reads nothing when every order is confirmed', () => {
    expect(quoteIdsToName([{ quoteId: 'q-1', jobNumber: 'J-1' }])).toEqual([]);
  });
});
