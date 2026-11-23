// Shared test fixtures: grade inputs, the stock widths of a product family and a settable clock.
import type { CreateGradeRequest, GradeWidth, ProductFamily } from '@erp/types';
import { createGradeRequestSchema } from '@erp/types';

import { DEFAULT_PALLET_FITS } from '../src/adapters/in-memory/in-memory-pallet-fit-repository';
import type { Clock, NewGrade } from '../src/ports';

export function familyStockWidths(productFamily: ProductFamily): GradeWidth[] {
  return DEFAULT_PALLET_FITS.filter((fit) => fit.productFamily === productFamily).map((fit) => ({
    rollWidthIn: fit.rollWidthIn,
    rollsPerPallet: fit.rollsPerPallet,
  }));
}

export const NOW = new Date('2026-08-05T09:00:00.000Z');

export class MutableClock implements Clock {
  #current: Date;
  constructor(start: Date = NOW) {
    this.#current = start;
  }
  now(): Date {
    return this.#current;
  }
  advance(ms: number): void {
    this.#current = new Date(this.#current.getTime() + ms);
  }
}

type RepositoryCreateInput = NewGrade & { id: string; createdAt: Date; updatedAt: Date };

export function newGradeInput(
  overrides: Partial<NewGrade> & { id: string; createdAt?: Date; updatedAt?: Date },
): RepositoryCreateInput {
  return {
    productFamily: 'kraft',
    code: '35#',
    basisWeightLb: '35.0000',
    reamAreaDivisor: '432.0000',
    paperCostPerTonne: '900.0000',
    footages: [
      { variant: 'long', label: 'Long roll', feetPerRoll: '1500.0000' },
      { variant: 'short', label: 'Short roll', feetPerRoll: '1100.0000' },
    ],
    widths: familyStockWidths(overrides.productFamily ?? 'kraft'),
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

export function createGradeRequest(overrides: Record<string, unknown> = {}): CreateGradeRequest {
  return createGradeRequestSchema.parse({
    productFamily: 'kraft',
    code: '35#',
    basisWeightLb: '35.0000',
    reamAreaDivisor: '432.0000',
    paperCostPerTonne: '900.0000',
    ...overrides,
  });
}
