// The paper grade master: basis weight, ream area, paper cost, footages and stock widths. The
// Billing Manager owns it: docs/product/roles.md. Edits are guarded by the grade's `lockVersion`:
// docs/decisions/006-optimistic-concurrency.md.
import { newId } from '@erp/db';
import type {
  CreateGradeRequest,
  Grade,
  GradeWidth,
  ProductFamily,
  UpdateGradeRequest,
} from '@erp/types';

import {
  DuplicateFootageVariantError,
  DuplicateStockWidthError,
  FootageVariantInUseError,
  StockWidthInUseError,
  type Clock,
  type GradePatch,
  type GradeRepository,
  type NewGrade,
  type PalletFitRepository,
  type QuoteRepository,
} from '../ports';

export interface GradeServiceOptions {
  grades: GradeRepository;

  quotes: QuoteRepository;

  palletFits: PalletFitRepository;
  clock: Clock;
}

function assertDistinctVariants(footages: readonly { variant: string }[]): void {
  const seen = new Set<string>();
  for (const f of footages) {
    if (seen.has(f.variant)) {
      throw new DuplicateFootageVariantError(f.variant);
    }
    seen.add(f.variant);
  }
}

function assertDistinctWidths(widths: readonly GradeWidth[]): void {
  const seen = new Set<number>();
  for (const w of widths) {
    if (seen.has(w.rollWidthIn)) {
      throw new DuplicateStockWidthError(w.rollWidthIn);
    }
    seen.add(w.rollWidthIn);
  }
}

function byWidth(widths: readonly GradeWidth[]): GradeWidth[] {
  return [...widths].sort((a, b) => a.rollWidthIn - b.rollWidthIn);
}

export class GradeService {
  readonly #grades: GradeRepository;
  readonly #quotes: QuoteRepository;
  readonly #palletFits: PalletFitRepository;
  readonly #clock: Clock;

  constructor(options: GradeServiceOptions) {
    this.#grades = options.grades;
    this.#quotes = options.quotes;
    this.#palletFits = options.palletFits;
    this.#clock = options.clock;
  }

  async create(request: CreateGradeRequest): Promise<Grade> {
    assertDistinctVariants(request.footages);
    // A new grade with no widths listed stocks every width in its family's pallet fit table.
    const widths =
      request.widths ??
      (await this.#palletFits.list(request.productFamily)).map((fit) => ({
        rollWidthIn: fit.rollWidthIn,
        rollsPerPallet: fit.rollsPerPallet,
      }));
    assertDistinctWidths(widths);
    const now = this.#clock.now();
    const input: NewGrade & { id: string; createdAt: Date; updatedAt: Date } = {
      id: newId(),
      productFamily: request.productFamily,
      code: request.code,
      basisWeightLb: request.basisWeightLb,
      reamAreaDivisor: request.reamAreaDivisor,
      paperCostPerTonne: request.paperCostPerTonne,
      footages: request.footages,
      widths: byWidth(widths),
      createdAt: now,
      updatedAt: now,
    };
    return this.#grades.create(input);
  }

  async findById(id: string): Promise<Grade | null> {
    return this.#grades.findById(id);
  }

  async list(productFamily?: ProductFamily): Promise<readonly Grade[]> {
    return this.#grades.list(productFamily === undefined ? {} : { productFamily });
  }

  async update(id: string, patch: UpdateGradeRequest): Promise<Grade | null> {
    if (patch.footages !== undefined) {
      assertDistinctVariants(patch.footages);
      await this.#assertRetiredVariantsAreUnused(id, patch.footages);
    }
    if (patch.widths !== undefined) {
      assertDistinctWidths(patch.widths);
      await this.#assertRetiredWidthsAreUnused(id, patch.widths);
    }
    const next: GradePatch = {
      ...(patch.code === undefined ? {} : { code: patch.code }),
      ...(patch.basisWeightLb === undefined ? {} : { basisWeightLb: patch.basisWeightLb }),
      ...(patch.reamAreaDivisor === undefined ? {} : { reamAreaDivisor: patch.reamAreaDivisor }),
      ...(patch.paperCostPerTonne === undefined
        ? {}
        : { paperCostPerTonne: patch.paperCostPerTonne }),
      ...(patch.footages === undefined ? {} : { footages: patch.footages }),
      ...(patch.widths === undefined ? {} : { widths: byWidth(patch.widths) }),
    };

    return this.#grades.update(id, next, this.#clock.now(), patch.lockVersion);
  }

  // A footage variant or stock width a draft quote line still uses cannot be removed from the
  // grade.
  async #assertRetiredVariantsAreUnused(
    id: string,
    footages: readonly { variant: string }[],
  ): Promise<void> {
    const current = await this.#grades.findById(id);
    if (current === null) return;

    const kept = new Set(footages.map((f) => f.variant));
    const retired = current.footages.map((f) => f.variant).filter((v) => !kept.has(v));

    for (const variant of retired) {
      const lines = await this.#quotes.draftLinesUsingGradeVariant(id, variant);
      if (lines.length > 0) {
        throw new FootageVariantInUseError(id, variant, lines);
      }
    }
  }

  async #assertRetiredWidthsAreUnused(id: string, widths: readonly GradeWidth[]): Promise<void> {
    const current = await this.#grades.findById(id);
    if (current === null) return;

    const kept = new Set(widths.map((w) => w.rollWidthIn));
    const retired = current.widths.map((w) => w.rollWidthIn).filter((w) => !kept.has(w));

    for (const rollWidthIn of retired) {
      const lines = await this.#quotes.draftLinesUsingGradeWidth(id, rollWidthIn);
      if (lines.length > 0) {
        throw new StockWidthInUseError(id, rollWidthIn, lines);
      }
    }
  }
}
