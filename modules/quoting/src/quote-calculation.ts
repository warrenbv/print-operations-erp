// The price of one quote line from its roll cost, tier, entered margin or hand-set price, and
// freight. Pure functions that touch no storage. The build-up they produce is shown on the price
// build-up page: docs/product/requirements.md (R3). Values stay as Decimal until they are
// serialised at their column's scale: docs/decisions/003-decimal-arithmetic.md. The caller that
// loads the inputs is modules/quoting/src/services/quote-pricing-service.ts.
import type {
  FreightInput,
  PricingBasis,
  PricingConfig,
  PricingTier,
  QuoteLine,
  QuoteLineCalculation,
  QuoteTotals,
  RollCostBreakdown,
  TierSelection,
} from '@erp/types';
import {
  evaluateFloor,
  marginPct,
  perPoundProductPrice,
  roundToCents,
  toDecimal,
  toMeasure,
  toMoney,
  toRate,
  type Decimal,
} from '@erp/types';

import { calculateFreight } from './freight';
import {
  EnteredMarginHandSetPriceError,
  EnteredMarginTierOverrideError,
  PerPoundHandSetPriceError,
  PerPoundNeedsOrderedWeightError,
  PerPoundNeedsRollWeightError,
  PerRollHandSetPoundPriceError,
  PerRollOrderedWeightError,
} from './ports';
import { tierMultiplier } from './tier-selection';

/** The tier price of a roll: total cost times 1 / (1 - tier margin). Not rounded. */
export function basePricePerRoll(
  totalCost: Decimal,
  tier: Pick<PricingTier, 'marginPct'>,
): Decimal {
  return totalCost.times(tierMultiplier(tier));
}

// Defined in packages/types/src/quote-calculation.ts and re-exported as part of this pricing
// surface.
export { marginPct, evaluateFloor } from '@erp/types';

export function applyOverwrap(basePrice: Decimal, wanted: boolean, surchargePct: string): Decimal {
  if (!wanted) {
    return basePrice;
  }
  return basePrice.times(toDecimal('1').plus(toDecimal(surchargePct)));
}

export interface PriceQuoteLineInput {
  cost: RollCostBreakdown;
  tier: TierSelection;
  config: Pick<PricingConfig, 'marginFloorPct' | 'overwrapSurchargePct' | 'ourVehicleFreightRate'>;

  pallets: number | null;
  quantityRolls: number;
  overwrap: boolean;

  pricingBasis?: PricingBasis;

  overridePricePerRoll?: string;

  overridePricePerLb?: string;

  marginOverridePct?: string;

  orderedWeightLb?: string;

  freight: FreightInput;

  exactTotalCostPerRoll?: Decimal;
}

/**
 * Prices one line. Refuses inconsistent inputs with the errors in modules/quoting/src/ports.ts: a
 * hand-set price on the other pricing basis, a per-pound line with no roll weight or no pounds
 * ordered, a per-roll line with pounds ordered, and an entered margin combined with a hand-set
 * price or a forced tier.
 */
export function priceQuoteLine(input: PriceQuoteLineInput): QuoteLineCalculation {
  // The unrounded cost is preferred, so the price is not built on a figure already rounded to money
  // scale.
  const totalCost = input.exactTotalCostPerRoll ?? toDecimal(input.cost.totalCostPerRoll);
  const quantity = toDecimal(String(input.quantityRolls));
  const freight = calculateFreight(input.freight, {
    ourVehicleFreightRate: input.config.ourVehicleFreightRate,
  });
  const freightCost = toDecimal(freight.cost);
  const freightInvoiceTotal = toDecimal(freight.invoiceTotal);

  const basePrice = basePricePerRoll(totalCost, input.tier.tier);

  const handSetPerRoll = input.overridePricePerRoll !== undefined;
  const handSetPerLb = input.overridePricePerLb !== undefined;
  const manual = handSetPerRoll || handSetPerLb;
  const basis = input.pricingBasis ?? 'per_roll';

  if (basis === 'per_pound' && handSetPerRoll) {
    throw new PerPoundHandSetPriceError();
  }

  if (basis === 'per_roll' && handSetPerLb) {
    throw new PerRollHandSetPoundPriceError();
  }

  const rollWeight = toDecimal(input.cost.rollWeightLb);

  if (basis === 'per_pound' && rollWeight.eq(0)) {
    throw new PerPoundNeedsRollWeightError();
  }

  if (basis === 'per_pound' && input.orderedWeightLb === undefined) {
    throw new PerPoundNeedsOrderedWeightError();
  }
  if (basis === 'per_roll' && input.orderedWeightLb !== undefined) {
    throw new PerRollOrderedWeightError();
  }

  const entered = input.marginOverridePct;
  if (entered !== undefined && manual) {
    throw new EnteredMarginHandSetPriceError();
  }
  if (entered !== undefined && input.tier.source === 'override') {
    throw new EnteredMarginTierOverrideError();
  }

  const marginPrice =
    entered === undefined ? undefined : totalCost.times(tierMultiplier({ marginPct: entered }));

  const pricedBase = marginPrice ?? basePrice;

  let productPrice: Decimal;
  if (input.overridePricePerLb !== undefined) {
    productPrice = toDecimal(input.overridePricePerLb).times(rollWeight);
  } else if (input.overridePricePerRoll !== undefined) {
    productPrice = toDecimal(input.overridePricePerRoll);
  } else {
    productPrice = applyOverwrap(pricedBase, input.overwrap, input.config.overwrapSurchargePct);
  }

  // The floor is judged on the product price alone. Freight margin does not count toward it,
  // docs/product/requirements.md (R6). For a tier or entered-margin price the overwrap surcharge is
  // left out as well, so neither can lift a thin price over the floor.
  const margin = marginPct(totalCost, manual ? productPrice : pricedBase);
  const floor = evaluateFloor(totalCost, margin, input.config.marginFloorPct);

  const basePricePerLb =
    basis === 'per_pound'
      ? toMoney(
          applyOverwrap(basePrice, input.overwrap, input.config.overwrapSurchargePct).div(
            rollWeight,
          ),
        )
      : undefined;

  const productPricePerLb =
    input.overridePricePerLb !== undefined
      ? toMoney(toDecimal(input.overridePricePerLb))
      : basis === 'per_pound' && marginPrice !== undefined
        ? toMoney(productPrice.div(rollWeight))
        : basePricePerLb;
  // A per-pound line's roll price is rebuilt from the per-pound price at money scale, so the
  // printed price per pound times the roll weight gives the printed roll price.
  const price =
    productPricePerLb === undefined ? productPrice : toDecimal(productPricePerLb).times(rollWeight);

  const freightPerRoll = quantity.eq(0) ? toDecimal('0') : freightInvoiceTotal.div(quantity);
  const deliveredPrice = price.plus(freightPerRoll);

  const orderedWeight = basis === 'per_pound' ? input.orderedWeightLb : undefined;
  const productExtended =
    productPricePerLb !== undefined && orderedWeight !== undefined
      ? perPoundProductPrice(productPricePerLb, orderedWeight)
      : price.times(quantity);
  const extendedPrice = productExtended.plus(freightInvoiceTotal);
  // Freight stays out of the roll price. It enters only the delivered price per roll and the
  // extended figures: docs/product/requirements.md (R4).
  const extendedCost = totalCost.times(quantity).plus(freightCost);

  const estimatedWeight = rollWeight.times(quantity);

  const pricedWeight = orderedWeight === undefined ? estimatedWeight : toDecimal(orderedWeight);

  return {
    cost: input.cost,
    tier: input.tier,
    pallets: input.pallets,
    quantityRolls: input.quantityRolls,
    ...(orderedWeight === undefined
      ? {}
      : { orderedWeightLb: toMeasure(toDecimal(orderedWeight)) }),

    basePricePerRoll: toMoney(basePrice),
    pricePerRoll: toMoney(price),
    priceSource: manual ? 'manual' : marginPrice === undefined ? 'tier' : 'margin',

    ...(marginPrice === undefined ? {} : { marginPricePerRoll: toMoney(marginPrice) }),
    deliveredPricePerRoll: toMoney(deliveredPrice),

    marginPct: toRate(margin),
    floor,

    extendedPrice: toMoney(extendedPrice),
    extendedCost: toMoney(extendedCost),
    extendedMargin: toMoney(extendedPrice.minus(extendedCost)),

    freight,

    estimatedWeightLb: toMeasure(estimatedWeight),

    pricePerLb: rollWeight.eq(0)
      ? toMoney(toDecimal('0'))
      : toMoney(deliveredPrice.div(rollWeight)),
    effectivePricePerLb: pricedWeight.eq(0)
      ? toMoney(toDecimal('0'))
      : toMoney(extendedPrice.div(pricedWeight)),

    pricingBasis: basis,

    ...(basePricePerLb === undefined ? {} : { basePricePerLb }),
    ...(productPricePerLb === undefined ? {} : { productPricePerLb }),
  };
}

/**
 * The quote's totals. Each line is rounded to cents before it is added, so the totals equal the sum
 * of the line amounts a customer sees.
 */
export function quoteTotals(lines: readonly QuoteLine[]): QuoteTotals {
  let price = toDecimal('0');
  let cost = toDecimal('0');
  let weight = toDecimal('0');

  for (const line of lines) {
    price = price.plus(toDecimal(roundToCents(line.extendedPrice)));
    cost = cost.plus(toDecimal(roundToCents(line.extendedCost)));
    weight = weight.plus(toDecimal(line.estimatedWeightLb));
  }

  return {
    extendedPrice: toMoney(price),
    extendedCost: toMoney(cost),

    extendedMargin: toMoney(price.minus(cost)),
    estimatedWeightLb: toMeasure(weight),
  };
}
