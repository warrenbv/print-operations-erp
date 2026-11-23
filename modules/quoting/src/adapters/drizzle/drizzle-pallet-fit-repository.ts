// The PostgreSQL adapter for `PalletFitRepository`. The rows are seeded by the baseline migration.
// Contract: modules/quoting/test/contracts/pallet-fit-repository.contract.ts.
import type { PalletFit, ProductFamily } from '@erp/types';
import { asc, eq } from 'drizzle-orm';

import type { QuotingDb } from '../../data/quoting-db';
import { palletFits } from '../../data/schema';
import type { PalletFitRepository } from '../../ports';

type Row = typeof palletFits.$inferSelect;

function toPalletFit(row: Row): PalletFit {
  return {
    id: row.id,

    productFamily: row.productFamily as ProductFamily,
    rollWidthIn: row.rollWidthIn,
    rollsPerPallet: row.rollsPerPallet,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export class DrizzlePalletFitRepository implements PalletFitRepository {
  readonly #db: QuotingDb;

  constructor(db: QuotingDb) {
    this.#db = db;
  }

  async list(productFamily: ProductFamily): Promise<readonly PalletFit[]> {
    const rows = await this.#db
      .select()
      .from(palletFits)
      .where(eq(palletFits.productFamily, productFamily))
      .orderBy(asc(palletFits.rollWidthIn));
    return rows.map(toPalletFit);
  }
}
