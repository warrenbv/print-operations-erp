// Roll geometry: weight from basis weight and size, and how many rolls fit on a pallet.
// Weight feeds the cost build-up in modules/quoting/src/cost-build-up.ts.
import type { PalletFit } from '@erp/types';
import { toDecimal, type Decimal } from '@erp/types';

const INCHES_PER_FOOT = toDecimal('12');

const REAM_BASIS_SHEETS = toDecimal('1000');

export interface RollWeightInput {
  basisWeightLb: string;

  rollWidthIn: number;

  feetPerRoll: string;

  reamAreaDivisor: string;
}

/**
 * Roll weight in pounds: basis weight times roll area, over the grade's ream area divisor times a
 * thousand sheets. Not rounded.
 */
export function rollWeightLb(input: RollWeightInput): Decimal {
  const divisor = toDecimal(input.reamAreaDivisor).times(REAM_BASIS_SHEETS);
  if (divisor.eq(0)) {
    throw new RangeError('reamAreaDivisor must not be zero — roll weight would be undefined');
  }

  const lengthIn = toDecimal(input.feetPerRoll).times(INCHES_PER_FOOT);
  const areaFactor = toDecimal(String(input.rollWidthIn)).times(lengthIn);

  return toDecimal(input.basisWeightLb).times(areaFactor).div(divisor);
}

/**
 * The pallet fit for the widest listed width at or below the roll width, used for a width the grade
 * does not stock. Null when the roll is narrower than every listed width.
 */
export function selectPalletFit(fits: readonly PalletFit[], rollWidthIn: number): PalletFit | null {
  let best: PalletFit | null = null;
  for (const fit of fits) {
    if (fit.rollWidthIn <= rollWidthIn && (best === null || fit.rollWidthIn > best.rollWidthIn)) {
      best = fit;
    }
  }
  return best;
}

/** Whole pallets needed for the quantity, rounded up. The count chooses the pricing tier. */
export function palletsForQuantity(quantityRolls: number, rollsPerPallet: number): number {
  if (rollsPerPallet <= 0) {
    throw new RangeError('rollsPerPallet must be positive');
  }
  return Math.ceil(quantityRolls / rollsPerPallet);
}
