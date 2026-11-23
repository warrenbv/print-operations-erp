// The cost of one roll: paper with waste, hardware (core, plugs and a share of the pallet) and
// optional converting and printing add-ons. Pure functions, fed by
// modules/quoting/src/services/roll-cost-service.ts. The cost is the first part of the price
// build-up in docs/product/requirements.md (R3). Arithmetic is Decimal throughout:
// docs/decisions/003-decimal-arithmetic.md.
import type { Grade, PricingConfig, RollCostBreakdown } from '@erp/types';
import { toDecimal, toMeasure, toMoney, type Decimal } from '@erp/types';

import { rollWeightLb } from './roll-geometry';

const POUNDS_PER_US_TON = toDecimal('2000');

export function paperCostPerLb(
  grade: Pick<Grade, 'paperCostPerTonne'>,
  config: Pick<PricingConfig, 'poundsPerTonne'>,
): Decimal {
  const perTonne = toDecimal(config.poundsPerTonne);
  if (perTonne.eq(0)) {
    throw new RangeError('poundsPerTonne must not be zero — paper $/lb would be undefined');
  }
  return toDecimal(grade.paperCostPerTonne).div(perTonne);
}

/** Paper cost grossed up for waste: weight times cost per pound, divided by (1 - waste). */
export function paperCostPerRoll(
  rollWeight: Decimal,
  costPerLb: Decimal,
  wastePct: string,
): Decimal {
  const survivingFraction = toDecimal('1').minus(toDecimal(wastePct));
  if (survivingFraction.lte(0)) {
    throw new RangeError(
      `wastePct ${wastePct} must be less than 1 — no quantity of paper survives 100% waste`,
    );
  }
  return rollWeight.times(costPerLb).div(survivingFraction);
}

/**
 * Core cost scaled to the roll width, plus plugs, plus the roll's share of a pallet. With no
 * rolls-per-pallet count the pallet share is left out.
 */
export function hardwareCostPerRoll(
  config: Pick<
    PricingConfig,
    'coreCostPerCore' | 'coreReferenceLengthIn' | 'plugCostPerPlug' | 'plugsPerRoll' | 'palletCost'
  >,
  rollWidthIn: number,
  rollsPerPallet: number | null,
): Decimal {
  const referenceLength = toDecimal(config.coreReferenceLengthIn);
  if (referenceLength.eq(0)) {
    throw new RangeError('coreReferenceLengthIn must not be zero — core $/inch would be undefined');
  }
  if (rollsPerPallet !== null && rollsPerPallet <= 0) {
    throw new RangeError('rollsPerPallet must be positive — pallet allocation would be undefined');
  }

  const corePerInch = toDecimal(config.coreCostPerCore).div(referenceLength);
  const core = corePerInch.times(toDecimal(String(rollWidthIn)));
  const plugs = toDecimal(config.plugCostPerPlug).times(toDecimal(String(config.plugsPerRoll)));
  if (rollsPerPallet === null) {
    return core.plus(plugs);
  }
  const pallet = toDecimal(config.palletCost).div(toDecimal(String(rollsPerPallet)));

  return core.plus(plugs).plus(pallet);
}

/** Converting and printing costs are entered per US ton and charged on the roll's weight. */
export function addOnCostPerRoll(
  rollWeight: Decimal,
  convertCostPerTon: string | undefined,
  printCostPerTon: string | undefined,
): Decimal {
  const convert = toDecimal(convertCostPerTon ?? '0');
  const print = toDecimal(printCostPerTon ?? '0');
  return convert.plus(print).div(POUNDS_PER_US_TON).times(rollWeight);
}

export interface BuildRollCostInput {
  grade: Pick<Grade, 'basisWeightLb' | 'reamAreaDivisor' | 'paperCostPerTonne'>;
  config: PricingConfig;
  rollWidthIn: number;

  rollsPerPallet: number | null;

  feetPerRoll: string;
  convertCostPerTon?: string;
  printCostPerTon?: string;
}

export interface RollCostResult {
  breakdown: RollCostBreakdown;
  exactTotalCostPerRoll: Decimal;
}

/**
 * The roll cost breakdown at its stored scales, plus the unrounded total. The total is kept so the
 * price is built on the exact cost rather than on a figure rounded to money scale.
 */
export function buildRollCostDetailed(input: BuildRollCostInput): RollCostResult {
  const weight = rollWeightLb({
    basisWeightLb: input.grade.basisWeightLb,
    rollWidthIn: input.rollWidthIn,

    reamAreaDivisor: input.grade.reamAreaDivisor,
    feetPerRoll: input.feetPerRoll,
  });

  const perLb = paperCostPerLb(input.grade, input.config);
  const paper = paperCostPerRoll(weight, perLb, input.config.wastePct);
  const hardware = hardwareCostPerRoll(input.config, input.rollWidthIn, input.rollsPerPallet);
  const addOns = addOnCostPerRoll(weight, input.convertCostPerTon, input.printCostPerTon);
  const total = paper.plus(hardware).plus(addOns);

  return {
    exactTotalCostPerRoll: total,
    breakdown: {
      rollWeightLb: toMeasure(weight),
      paperCostPerLb: toMoney(perLb),
      paperCostPerRoll: toMoney(paper),
      hardwareCostPerRoll: toMoney(hardware),
      addOnCostPerRoll: toMoney(addOns),
      totalCostPerRoll: toMoney(total),
      rollsPerPallet: input.rollsPerPallet,
      feetPerRoll: toMeasure(toDecimal(input.feetPerRoll)),
    },
  };
}
