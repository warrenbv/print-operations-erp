// Totals for one order, computed from its stored lines and never from quoting:
// docs/decisions/002-what-crosses-a-module-boundary.md.
import type { OrderLine, OrderTotals } from '@erp/types';
import { roundToCents, toDecimal, toMeasure, toMoney } from '@erp/types';

/**
 * Each line's money is rounded to cents before it is added, so a total equals the sum of the line
 * amounts a reader sees. Results are money strings at four places, and margin is the rounded
 * price total minus the rounded cost total: docs/decisions/003-decimal-arithmetic.md.
 */
export function orderTotals(lines: readonly OrderLine[]): OrderTotals {
  let price = toDecimal('0');
  let cost = toDecimal('0');
  let weight = toDecimal('0');
  let freightCost = toDecimal('0');
  let freightMargin = toDecimal('0');
  let freightPending = false;

  for (const line of lines) {
    price = price.plus(toDecimal(roundToCents(line.extendedPrice)));
    cost = cost.plus(toDecimal(roundToCents(line.extendedCost)));
    weight = weight.plus(toDecimal(line.estimatedWeightLb));
    freightCost = freightCost.plus(toDecimal(roundToCents(line.freightResult.cost)));
    freightMargin = freightMargin.plus(toDecimal(roundToCents(line.freightResult.margin)));

    freightPending = freightPending || line.freightResult.pending;
  }

  const freightInvoiceTotal = freightCost.plus(freightMargin);

  return {
    extendedPrice: toMoney(price),
    extendedCost: toMoney(cost),

    extendedMargin: toMoney(price.minus(cost)),
    estimatedWeightLb: toMeasure(weight),

    freightCost: toMoney(freightCost),
    freightMargin: toMoney(freightMargin),

    freightInvoiceTotal: toMoney(freightInvoiceTotal),
    freightPending,
  };
}
