// orderTotals in modules/orders/src/order-totals.ts, including rounding each line to cents first.
import type { OrderLine } from '@erp/types';
import { formatMoney } from '@erp/types';
import { describe, expect, it } from 'vitest';

import { orderTotals } from '../src/order-totals';

function line(over: Partial<Record<string, unknown>>): OrderLine {
  return {
    extendedPrice: '0.0000',
    extendedCost: '0.0000',
    estimatedWeightLb: '0.0000',
    freightResult: { cost: '0.0000', margin: '0.0000', invoiceTotal: '0.0000', pending: false },
    ...over,
  } as unknown as OrderLine;
}

describe('orderTotals', () => {
  it('adds the lines a reader can see, not the four-place ones behind them', () => {
    const totals = orderTotals([
      line({ extendedPrice: '318.2439', extendedCost: '201.5500' }),
      line({ extendedPrice: '52.4167', extendedCost: '33.0900' }),
    ]);

    expect(totals.extendedPrice).toBe('370.6600');
    expect(formatMoney(totals.extendedPrice)).toBe('$370.66');

    expect(formatMoney('318.2439')).toBe('$318.24');
    expect(formatMoney('52.4167')).toBe('$52.42');
  });

  it('rounds the freight breakdown the same way, so it adds up too', () => {
    const totals = orderTotals([
      line({
        extendedPrice: '277.8276',
        freightResult: {
          cost: '236.0000',
          margin: '41.8276',
          invoiceTotal: '277.8276',
          pending: false,
        },
      }),
    ]);

    expect(totals.freightCost).toBe('236.0000');
    expect(totals.freightMargin).toBe('41.8300');
    expect(totals.freightInvoiceTotal).toBe('277.8300');
    expect(formatMoney(totals.freightInvoiceTotal)).toBe('$277.83');
  });

  it('derives margin from the two sums rather than summing the lines', () => {
    const totals = orderTotals([
      line({ extendedPrice: '14.3850', extendedCost: '7.6020' }),
      line({ extendedPrice: '14.3850', extendedCost: '7.6020' }),
    ]);

    expect(totals.extendedPrice).toBe('28.7800');
    expect(totals.extendedCost).toBe('15.2000');
    expect(totals.extendedMargin).toBe('13.5800');
  });

  it('is pending when any line is, whatever the money says', () => {
    const totals = orderTotals([
      line({}),
      line({
        freightResult: {
          cost: '0.0000',
          margin: '0.0000',
          invoiceTotal: '0.0000',
          pending: true,
        },
      }),
    ]);

    expect(totals.freightPending).toBe(true);
  });
});
