// The PostgreSQL adapter for `TaxRateRepository` in
// modules/quoting/src/services/tax-rate-service.ts. Contract:
// modules/quoting/test/contracts/tax-rate-repository.contract.ts.
import { taxRatePartsOf, type NewTaxRate, type TaxRate, type TaxRateSource } from '@erp/types';
import { newId } from '@erp/db';
import { and, asc, desc, eq, inArray, isNull, lte } from 'drizzle-orm';

import type { QuotingDb } from '../../data/quoting-db';
import { taxRates } from '../../data/schema';
import type {
  ImportedTaxRates,
  TaxRateKey,
  TaxRateRepository,
} from '../../services/tax-rate-service';

function toTaxRate(row: typeof taxRates.$inferSelect): TaxRate {
  return {
    id: row.id,
    jurisdiction: row.jurisdiction,
    rate: row.rate,

    effectiveFrom: dayOf(row.effectiveFrom),
    source: row.source as TaxRateSource,
    ...(row.name === null ? {} : { name: row.name }),

    ...(row.stateRate === null || row.localRate === null || row.rtaRate === null
      ? {}
      : { stateRate: row.stateRate, localRate: row.localRate, rtaRate: row.rtaRate }),
    createdAt: row.createdAt.toISOString(),
  };
}

function dayOf(value: unknown): string {
  return String(value).slice(0, 10);
}

function keyOf(row: { jurisdiction: string; effectiveFrom: string }): string {
  return `${row.jurisdiction}|${row.effectiveFrom}`;
}

export class DrizzleTaxRateRepository implements TaxRateRepository {
  readonly #db: QuotingDb;

  constructor(db: QuotingDb) {
    this.#db = db;
  }

  async history(jurisdiction: string): Promise<readonly TaxRate[]> {
    const rows = await this.#db
      .select()
      .from(taxRates)
      .where(eq(taxRates.jurisdiction, jurisdiction))
      .orderBy(desc(taxRates.effectiveFrom));
    return rows.map(toTaxRate);
  }

  async currentRates(asOf: string): Promise<readonly TaxRate[]> {
    const rows = await this.#db
      .selectDistinctOn([taxRates.jurisdiction])
      .from(taxRates)
      .where(lte(taxRates.effectiveFrom, asOf))
      .orderBy(asc(taxRates.jurisdiction), desc(taxRates.effectiveFrom));
    return rows.map(toTaxRate);
  }

  async existingFor(keys: readonly TaxRateKey[]): Promise<readonly TaxRate[]> {
    if (keys.length === 0) {
      return [];
    }

    const jurisdictions = [...new Set(keys.map((key) => key.jurisdiction))];
    const days = [...new Set(keys.map((key) => key.effectiveFrom))];
    const rows = await this.#db
      .select()
      .from(taxRates)
      .where(
        and(inArray(taxRates.jurisdiction, jurisdictions), inArray(taxRates.effectiveFrom, days)),
      );

    const wanted = new Set(keys.map((key) => `${key.jurisdiction}|${key.effectiveFrom}`));
    return rows
      .map(toTaxRate)
      .filter((row) => wanted.has(`${row.jurisdiction}|${row.effectiveFrom}`));
  }

  async importRates(rates: readonly NewTaxRate[]): Promise<ImportedTaxRates> {
    if (rates.length === 0) {
      return { inserted: 0, skipped: 0, filled: 0 };
    }

    return this.#db.transaction(async (tx) => {
      const landed = await tx
        .insert(taxRates)
        .values(
          rates.map((rate) => ({
            id: newId(),
            jurisdiction: rate.jurisdiction,
            rate: rate.rate,
            effectiveFrom: rate.effectiveFrom,
            source: rate.source,
            name: rate.name ?? null,
            stateRate: rate.stateRate ?? null,
            localRate: rate.localRate ?? null,
            rtaRate: rate.rtaRate ?? null,
          })),
        )
        // A stored row is kept, never overwritten. The loop below only fills missing rate parts.
        .onConflictDoNothing({ target: [taxRates.jurisdiction, taxRates.effectiveFrom] })
        .returning({ jurisdiction: taxRates.jurisdiction, effectiveFrom: taxRates.effectiveFrom });

      const inserted = new Set(
        landed.map((row) =>
          keyOf({ jurisdiction: row.jurisdiction, effectiveFrom: dayOf(row.effectiveFrom) }),
        ),
      );

      let filled = 0;
      for (const rate of rates) {
        const parts = taxRatePartsOf(rate);
        if (parts === null || inserted.has(keyOf(rate))) {
          continue;
        }
        const done = await tx
          .update(taxRates)
          .set(parts)
          .where(
            and(
              eq(taxRates.jurisdiction, rate.jurisdiction),
              eq(taxRates.effectiveFrom, rate.effectiveFrom),
              eq(taxRates.rate, rate.rate),
              isNull(taxRates.stateRate),
              isNull(taxRates.localRate),
              isNull(taxRates.rtaRate),
            ),
          )
          .returning({ id: taxRates.id });
        filled += done.length;
      }

      return { inserted: landed.length, skipped: rates.length - landed.length, filled };
    });
  }
}
