// Freight for one quote line, priced by shipping mode and kept apart from the roll price:
// docs/product/requirements.md (R4). Only carrier freight can carry a margin, and that margin never
// counts toward the margin floor: docs/product/requirements.md (R6).
import type { FreightInput, FreightResult } from '@erp/types';
import { toDecimal, toMoney, type Decimal } from '@erp/types';

export function calculateFreight(
  input: FreightInput,
  config: { ourVehicleFreightRate: string },
): FreightResult {
  const configRate = toDecimal(config.ourVehicleFreightRate);

  switch (input.mode) {
    case 'pickup':
      return zeroResult('pickup');

    case 'our_vehicle': {
      const rate = input.rateOverride === undefined ? configRate : toDecimal(input.rateOverride);
      return withoutMargin('our_vehicle', rate);
    }

    // The configured or overridden rate plus a carrier's bid, both at cost. The freight stays
    // pending until the bid is entered.
    case 'pass_through': {
      const rate = input.rateOverride === undefined ? configRate : toDecimal(input.rateOverride);

      if (input.carrierBid === undefined) {
        return { ...withoutMargin('pass_through', rate), pending: true };
      }

      const bid = toDecimal(input.carrierBid);
      return withoutMargin('pass_through', rate.plus(bid));
    }

    // A carrier's bid, marked up by the freight margin when one is entered. Pending until the bid
    // is entered.
    case 'carrier': {
      if (input.carrierBid === undefined) {
        return { ...zeroResult('carrier'), pending: true };
      }

      const cost = toDecimal(input.carrierBid);
      if (input.freightMarginPct === undefined) {
        return withoutMargin('carrier', cost);
      }
      const marginPct = toDecimal(input.freightMarginPct);
      const invoiceTotal = cost.div(toDecimal('1').minus(marginPct));
      const margin = invoiceTotal.minus(cost);
      return {
        mode: 'carrier',
        cost: toMoney(cost),
        margin: toMoney(margin),
        invoiceTotal: toMoney(invoiceTotal),
        pending: false,
      };
    }
  }
}

function zeroResult(mode: FreightResult['mode']): FreightResult {
  const zero = toDecimal('0');
  return {
    mode,
    cost: toMoney(zero),
    margin: toMoney(zero),
    invoiceTotal: toMoney(zero),
    pending: false,
  };
}

function withoutMargin(mode: FreightResult['mode'], cost: Decimal): FreightResult {
  const zero = toDecimal('0');
  return {
    mode,
    cost: toMoney(cost),
    margin: toMoney(zero),
    invoiceTotal: toMoney(cost),
    pending: false,
  };
}
