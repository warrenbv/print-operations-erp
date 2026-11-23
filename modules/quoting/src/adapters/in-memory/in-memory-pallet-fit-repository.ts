// The in-memory adapter for `PalletFitRepository`. Contract:
// modules/quoting/test/contracts/pallet-fit-repository.contract.ts.
import type { PalletFit, ProductFamily } from '@erp/types';

import type { PalletFitRepository } from '../../ports';

export interface PalletFitSeed {
  productFamily: ProductFamily;
  rollWidthIn: number;
  rollsPerPallet: number;
}

// Fictional reference rows. They equal the pallet_fits rows seeded by
// infra/db/migrations/quoting/0000_baseline.sql, in the same order, so the ids built below match.
export const DEFAULT_PALLET_FITS: readonly PalletFitSeed[] = [
  { productFamily: 'kraft', rollWidthIn: 8, rollsPerPallet: 108 },
  { productFamily: 'kraft', rollWidthIn: 10, rollsPerPallet: 86 },
  { productFamily: 'kraft', rollWidthIn: 12, rollsPerPallet: 72 },
  { productFamily: 'kraft', rollWidthIn: 16, rollsPerPallet: 54 },
  { productFamily: 'kraft', rollWidthIn: 18, rollsPerPallet: 48 },
  { productFamily: 'kraft', rollWidthIn: 24, rollsPerPallet: 36 },
  { productFamily: 'kraft', rollWidthIn: 28, rollsPerPallet: 30 },
  { productFamily: 'kraft', rollWidthIn: 36, rollsPerPallet: 24 },
  { productFamily: 'kraft', rollWidthIn: 42, rollsPerPallet: 20 },
  { productFamily: 'kraft', rollWidthIn: 54, rollsPerPallet: 16 },
  { productFamily: 'butcher', rollWidthIn: 10, rollsPerPallet: 76 },
  { productFamily: 'butcher', rollWidthIn: 12, rollsPerPallet: 64 },
  { productFamily: 'butcher', rollWidthIn: 18, rollsPerPallet: 42 },
  { productFamily: 'butcher', rollWidthIn: 24, rollsPerPallet: 32 },
  { productFamily: 'butcher', rollWidthIn: 26, rollsPerPallet: 29 },
  { productFamily: 'butcher', rollWidthIn: 32, rollsPerPallet: 24 },
  { productFamily: 'butcher', rollWidthIn: 36, rollsPerPallet: 21 },
  { productFamily: 'butcher', rollWidthIn: 44, rollsPerPallet: 17 },
  { productFamily: 'butcher', rollWidthIn: 50, rollsPerPallet: 15 },
  { productFamily: 'butcher', rollWidthIn: 66, rollsPerPallet: 11 },
  { productFamily: 'newsprint', rollWidthIn: 8, rollsPerPallet: 126 },
  { productFamily: 'newsprint', rollWidthIn: 12, rollsPerPallet: 84 },
  { productFamily: 'newsprint', rollWidthIn: 17, rollsPerPallet: 59 },
  { productFamily: 'newsprint', rollWidthIn: 22, rollsPerPallet: 46 },
  { productFamily: 'newsprint', rollWidthIn: 24, rollsPerPallet: 42 },
  { productFamily: 'newsprint', rollWidthIn: 28, rollsPerPallet: 36 },
  { productFamily: 'newsprint', rollWidthIn: 34, rollsPerPallet: 30 },
  { productFamily: 'newsprint', rollWidthIn: 36, rollsPerPallet: 28 },
  { productFamily: 'newsprint', rollWidthIn: 42, rollsPerPallet: 24 },
  { productFamily: 'newsprint', rollWidthIn: 54, rollsPerPallet: 18 },
  { productFamily: 'digital_bond', rollWidthIn: 8, rollsPerPallet: 144 },
  { productFamily: 'digital_bond', rollWidthIn: 11, rollsPerPallet: 104 },
  { productFamily: 'digital_bond', rollWidthIn: 12, rollsPerPallet: 96 },
  { productFamily: 'digital_bond', rollWidthIn: 17, rollsPerPallet: 68 },
  { productFamily: 'digital_bond', rollWidthIn: 22, rollsPerPallet: 52 },
  { productFamily: 'digital_bond', rollWidthIn: 24, rollsPerPallet: 48 },
  { productFamily: 'digital_bond', rollWidthIn: 28, rollsPerPallet: 41 },
];

export class InMemoryPalletFitRepository implements PalletFitRepository {
  readonly #fits = new Map<string, PalletFit>();

  constructor(seed: readonly PalletFitSeed[] = DEFAULT_PALLET_FITS) {
    seed.forEach((fit, index) => {
      this.#fits.set(key(fit.productFamily, fit.rollWidthIn), {
        id: `01988a00-0002-7000-8000-${String(index + 1).padStart(12, '0')}`,
        productFamily: fit.productFamily,
        rollWidthIn: fit.rollWidthIn,
        rollsPerPallet: fit.rollsPerPallet,
        updatedAt: new Date(0).toISOString(),
      });
    });
  }

  async list(productFamily: ProductFamily): Promise<readonly PalletFit[]> {
    return [...this.#fits.values()]
      .filter((fit) => fit.productFamily === productFamily)
      .sort((a, b) => a.rollWidthIn - b.rollWidthIn);
  }
}

function key(productFamily: string, rollWidthIn: number): string {
  return `${productFamily}:${rollWidthIn}`;
}
