// Tax rates are imported rows chosen by effective date, never a live lookup. A line's tax treatment
// names a jurisdiction from these rows: docs/product/requirements.md (R4). The port and its two
// adapters are held to modules/quoting/test/contracts/tax-rate-repository.contract.ts.
import {
  parseTaxRateImport,
  quarterStartOf,
  taxRatePartsOf,
  type ImportTaxRatesResponse,
  type NewTaxRate,
  type TaxRate,
  type TaxRateImportFormat,
  type TaxRatePreviewRow,
  type TaxRateSummary,
} from '@erp/types';

export type TaxRateKey = Pick<NewTaxRate, 'jurisdiction' | 'effectiveFrom'>;

export interface TaxRateRepository {
  history(jurisdiction: string): Promise<readonly TaxRate[]>;

  currentRates(asOf: string): Promise<readonly TaxRate[]>;

  existingFor(keys: readonly TaxRateKey[]): Promise<readonly TaxRate[]>;

  // Inserts new rows, skips stored ones, and fills the rate parts of a stored row that has none
  // when its rate matches. A stored rate is never overwritten.
  importRates(rates: readonly NewTaxRate[]): Promise<ImportedTaxRates>;
}

export interface ImportedTaxRates {
  readonly inserted: number;
  readonly skipped: number;

  readonly filled: number;
}

export class TaxRateService {
  readonly #rates: TaxRateRepository;

  constructor(rates: TaxRateRepository) {
    this.#rates = rates;
  }

  async history(jurisdiction: string): Promise<readonly TaxRate[]> {
    return this.#rates.history(jurisdiction.trim());
  }

  async isLoaded(jurisdiction: string): Promise<boolean> {
    return (await this.history(jurisdiction)).length > 0;
  }

  async importRates(rates: readonly NewTaxRate[]): Promise<ImportedTaxRates> {
    return this.#rates.importRates(rates);
  }

  async currentRates(asOf: string): Promise<readonly TaxRateSummary[]> {
    const currentQuarter = quarterStartOf(asOf);
    const rows = await this.#rates.currentRates(asOf);
    return rows.map((row) => ({
      ...row,
      // A row from the address-rates source is stale when it took effect before the current quarter
      // began.
      stale: row.source === 'wa_dor' && row.effectiveFrom < currentQuarter,
    }));
  }

  async load(
    text: string,
    format: TaxRateImportFormat,
    options: { readonly dryRun: boolean },
  ): Promise<ImportTaxRatesResponse> {
    const parsed = parseTaxRateImport(text, format);
    const rows = parsed.rows;

    const issues =
      rows.length === 0 && parsed.issues.length === 0
        ? [{ line: 1, message: 'no rows were found in the text' }]
        : parsed.issues;
    const stored = new Map(
      (await this.#rates.existingFor(rows)).map((row) => [
        `${row.jurisdiction}|${row.effectiveFrom}`,
        row,
      ]),
    );

    const classified: TaxRatePreviewRow[] = rows.map((row) => {
      const existing = stored.get(`${row.jurisdiction}|${row.effectiveFrom}`);
      if (existing === undefined) {
        return { ...row, verdict: 'new' };
      }
      if (existing.rate !== row.rate) {
        return { ...row, verdict: 'conflict', storedRate: existing.rate };
      }
      const fills = taxRatePartsOf(existing) === null && taxRatePartsOf(row) !== null;
      return fills
        ? { ...row, verdict: 'unchanged', fillsParts: true }
        : { ...row, verdict: 'unchanged' };
    });

    // A load is all or nothing. Any parse issue, or any row whose rate differs from the stored one
    // for the same jurisdiction and date, refuses the whole load. A dry run reports the same
    // verdicts.
    const refused = issues.length > 0 || classified.some((row) => row.verdict === 'conflict');

    if (refused || options.dryRun) {
      return {
        dryRun: options.dryRun,
        refused,
        inserted: 0,
        skipped: 0,
        filled: 0,
        rows: classified,
        issues: [...issues],
      };
    }

    const written = await this.#rates.importRates(rows);
    return { dryRun: false, refused: false, ...written, rows: classified, issues: [...issues] };
  }
}
