// The in-memory adapter for `TaxRateRepository`. Contract:
// modules/quoting/test/contracts/tax-rate-repository.contract.ts.
import {
  taxRatePartsOf,
  toDecimal,
  type NewTaxRate,
  type TaxRate,
  type TaxRateParts,
} from '@erp/types';
import { newId } from '@erp/db';

import type {
  ImportedTaxRates,
  TaxRateKey,
  TaxRateRepository,
} from '../../services/tax-rate-service';

// The reference row this adapter starts with. It equals the tax_rates row seeded by
// infra/db/migrations/quoting/0000_baseline.sql.
const STATUTE_RATES: readonly NewTaxRate[] = [
  { jurisdiction: 'ID', rate: '0.060000', effectiveFrom: '2001-01-01', source: 'statute' },
];

export class InMemoryTaxRateRepository implements TaxRateRepository {
  readonly #rows: TaxRate[] = [];

  constructor(seed: readonly NewTaxRate[] = STATUTE_RATES) {
    for (const rate of seed) {
      this.#rows.push({ ...rate, id: newId(), createdAt: new Date().toISOString() });
    }
  }

  async history(jurisdiction: string): Promise<readonly TaxRate[]> {
    return this.#rows
      .filter((row) => row.jurisdiction === jurisdiction)
      .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom));
  }

  async currentRates(asOf: string): Promise<readonly TaxRate[]> {
    const latest = new Map<string, TaxRate>();
    for (const row of this.#rows) {
      if (row.effectiveFrom > asOf) continue;
      const held = latest.get(row.jurisdiction);
      if (held === undefined || row.effectiveFrom > held.effectiveFrom) {
        latest.set(row.jurisdiction, row);
      }
    }
    return [...latest.values()].sort((a, b) => a.jurisdiction.localeCompare(b.jurisdiction));
  }

  async existingFor(keys: readonly TaxRateKey[]): Promise<readonly TaxRate[]> {
    const wanted = new Set(keys.map((key) => `${key.jurisdiction}|${key.effectiveFrom}`));
    return this.#rows.filter((row) => wanted.has(`${row.jurisdiction}|${row.effectiveFrom}`));
  }

  async importRates(rates: readonly NewTaxRate[]): Promise<ImportedTaxRates> {
    for (const rate of rates) assertPartsRule(rate.rate, rate);

    const inserts: NewTaxRate[] = [];
    const fills: { index: number; parts: TaxRateParts }[] = [];
    const planned = new Set<string>();
    for (const rate of rates) {
      const key = `${rate.jurisdiction}|${rate.effectiveFrom}`;

      const index = this.#rows.findIndex(
        (row) => row.jurisdiction === rate.jurisdiction && row.effectiveFrom === rate.effectiveFrom,
      );
      if (index === -1 && !planned.has(key)) {
        planned.add(key);
        inserts.push(rate);
        continue;
      }

      const stored = this.#rows[index];
      const parts = taxRatePartsOf(rate);
      if (
        stored !== undefined &&
        parts !== null &&
        stored.rate === rate.rate &&
        taxRatePartsOf(stored) === null &&
        !fills.some((fill) => fill.index === index)
      ) {
        fills.push({ index, parts });
      }
    }

    for (const rate of inserts) {
      this.#rows.push({ ...rate, id: newId(), createdAt: new Date().toISOString() });
    }
    for (const { index, parts } of fills) {
      this.#rows[index] = { ...(this.#rows[index] as TaxRate), ...parts };
    }
    return {
      inserted: inserts.length,
      skipped: rates.length - inserts.length,
      filled: fills.length,
    };
  }
}

// Mirrors the tax_rates_parts_check constraint in infra/db/migrations/quoting/0000_baseline.sql.
function assertPartsRule(rate: string, row: TaxRateParts): void {
  const given = [row.stateRate, row.localRate, row.rtaRate];
  if (given.every((part) => part === undefined)) {
    return;
  }
  const parts = taxRatePartsOf(row);
  const ratio = (part: string): boolean => toDecimal(part).gte(0) && toDecimal(part).lt(1);
  if (
    parts === null ||
    !ratio(parts.stateRate) ||
    !ratio(parts.localRate) ||
    !ratio(parts.rtaRate) ||
    !toDecimal(parts.stateRate).plus(parts.localRate).plus(parts.rtaRate).eq(rate)
  ) {
    throw new Error(
      `tax_rates_parts_check: State, Local and RTA must be all absent, or all present and add up to ${rate}`,
    );
  }
}
