// Loads a grade, its footage and pallet count and the pricing configuration, and builds the roll
// cost with modules/quoting/src/cost-build-up.ts.
import type { GradeWidth, PalletFit, ProductFamily, RollCostRequest } from '@erp/types';

import { buildRollCostDetailed, type RollCostResult } from '../cost-build-up';
import {
  NoPalletFitForWidthError,
  UnknownFootageVariantError,
  type GradeRepository,
  type PalletFitRepository,
  type PricingConfigRepository,
} from '../ports';
import { selectPalletFit } from '../roll-geometry';

export interface RollCostServiceOptions {
  grades: GradeRepository;
  config: PricingConfigRepository;
  palletFits: PalletFitRepository;
}

export class RollCostService {
  readonly #grades: GradeRepository;
  readonly #config: PricingConfigRepository;
  readonly #palletFits: PalletFitRepository;

  constructor(options: RollCostServiceOptions) {
    this.#grades = options.grades;
    this.#config = options.config;
    this.#palletFits = options.palletFits;
  }

  async listPalletFits(productFamily: ProductFamily): Promise<readonly PalletFit[]> {
    return this.#palletFits.list(productFamily);
  }

  async costRollDetailed(request: RollCostRequest): Promise<RollCostResult | null> {
    const grade = await this.#grades.findById(request.gradeId);
    if (grade === null) {
      return null;
    }

    const feetPerRoll = this.#resolveFootage(request, grade.footages, grade.id);

    const rollsPerPallet = await this.#rollsPerPallet(grade, request.rollWidthIn);

    const config = await this.#config.get();

    return buildRollCostDetailed({
      grade,
      config,
      rollWidthIn: request.rollWidthIn,
      rollsPerPallet,
      feetPerRoll,
      convertCostPerTon: request.convertCostPerTon,
      printCostPerTon: request.printCostPerTon,
    });
  }

  async isStockWidth(gradeId: string, rollWidthIn: number): Promise<boolean | null> {
    const grade = await this.#grades.findById(gradeId);
    return grade === null ? null : grade.widths.some((w) => w.rollWidthIn === rollWidthIn);
  }

  // A stock width carries its own rolls-per-pallet count. A custom width takes the count from the
  // family's pallet fit table and fails with NoPalletFitForWidthError when nothing fits.
  async #rollsPerPallet(
    grade: { productFamily: ProductFamily; widths: readonly GradeWidth[] },
    rollWidthIn: number,
  ): Promise<number | null> {
    const stock = grade.widths.find((w) => w.rollWidthIn === rollWidthIn);
    if (stock !== undefined) {
      return stock.rollsPerPallet;
    }
    const fits = await this.#palletFits.list(grade.productFamily);
    const fit = selectPalletFit(fits, rollWidthIn);
    if (fit === null) {
      throw new NoPalletFitForWidthError(grade.productFamily, rollWidthIn);
    }
    return fit.rollsPerPallet;
  }

  #resolveFootage(
    request: RollCostRequest,
    footages: readonly { variant: string; feetPerRoll: string }[],
    gradeId: string,
  ): string {
    // A footage entered on the line wins over the grade's named variants.
    if (request.feetPerRollOverride !== undefined) {
      return request.feetPerRollOverride;
    }

    const match = footages.find((f) => f.variant === request.footageVariant);
    if (match === undefined) {
      throw new UnknownFootageVariantError(gradeId, request.footageVariant);
    }
    return match.feetPerRoll;
  }
}
