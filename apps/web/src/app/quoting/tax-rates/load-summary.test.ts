// Tests the message for a checked, loaded or refused rates file.
import type { ImportTaxRatesResponse, TaxRatePreviewRow } from '@erp/types';
import { describe, expect, it } from 'vitest';

import { summariseLoad } from './load-summary';

function row(overrides: Partial<TaxRatePreviewRow> = {}): TaxRatePreviewRow {
  return {
    jurisdiction: 'WA-0202',
    rate: '0.085000',
    effectiveFrom: '2026-07-01',
    source: 'wa_dor',
    verdict: 'new',
    ...overrides,
  };
}

function report(overrides: Partial<ImportTaxRatesResponse> = {}): ImportTaxRatesResponse {
  return {
    dryRun: true,
    refused: false,
    inserted: 0,
    skipped: 0,
    filled: 0,
    rows: [row()],
    issues: [],
    ...overrides,
  };
}

function filling(jurisdiction: string): TaxRatePreviewRow {
  return row({ jurisdiction, verdict: 'unchanged', fillsParts: true });
}

describe('summariseLoad', () => {
  it('reports a clean dry run and says nothing was written', () => {
    const summary = summariseLoad(
      report({ rows: [row(), row({ jurisdiction: 'WA-3800', verdict: 'unchanged' })] }),
    );

    expect(summary.channel).toBe('notice');
    expect(summary.message).toContain('Checked 2 rows');
    expect(summary.message).toContain('1 new');
    expect(summary.message).toContain('1 already on file');
    expect(summary.message).toContain('Nothing was written');
  });

  it('reports what an apply actually wrote', () => {
    const summary = summariseLoad(
      report({ dryRun: false, inserted: 401, skipped: 2, rows: [row()] }),
    );

    expect(summary.channel).toBe('notice');
    expect(summary.message).toBe('Loaded 401 rates. 2 were already on file.');
  });

  it('leaves the skipped clause off when nothing was skipped', () => {
    expect(summariseLoad(report({ dryRun: false, inserted: 1, skipped: 0 })).message).toBe(
      'Loaded 1 rate.',
    );
  });

  it('agrees the verb when exactly one row was already on file', () => {
    expect(summariseLoad(report({ dryRun: false, inserted: 0, skipped: 1 })).message).toBe(
      'Loaded 0 rates. 1 was already on file.',
    );
  });

  it('still says "were" for more than one', () => {
    expect(summariseLoad(report({ dryRun: false, inserted: 0, skipped: 2 })).message).toBe(
      'Loaded 0 rates. 2 were already on file.',
    );
  });

  it('agrees the verb for a single conflicting jurisdiction', () => {
    const summary = summariseLoad(
      report({
        refused: true,
        rows: [
          row({
            jurisdiction: 'WA-0202',
            verdict: 'conflict',
            storedRate: '0.085000',
            rate: '0.086000',
          }),
        ],
      }),
    );

    expect(summary.message).toContain('1 jurisdiction already has a different rate');
    expect(summary.message).not.toContain('already have');
  });

  it('names a conflicting jurisdiction and both rates', () => {
    const summary = summariseLoad(
      report({
        refused: true,
        rows: [row({ verdict: 'conflict', rate: '0.090000', storedRate: '0.085000' })],
      }),
    );

    expect(summary.channel).toBe('error');
    expect(summary.message).toContain('Nothing was loaded');
    const conflict = 'WA-0202 on 2026-07-01 is 0.085000, not 0.090000';
    expect(summary.message).toContain(conflict);

    expect(summary.message).toContain('needs a later effective date');
  });

  it('names an unreadable line with its number', () => {
    const summary = summariseLoad(
      report({
        refused: true,
        rows: [],
        issues: [{ line: 7, message: 'rate "8.5" is not a ratio' }],
      }),
    );

    expect(summary.channel).toBe('error');
    expect(summary.message).toContain('1 line could not be read');
    expect(summary.message).toContain('line 7: rate "8.5" is not a ratio');
  });

  it('names three problems and counts the rest', () => {
    const summary = summariseLoad(
      report({
        refused: true,
        rows: [],
        issues: Array.from({ length: 50 }, (_, index) => ({
          line: index + 1,
          message: 'unreadable',
        })),
      }),
    );

    expect(summary.message).toContain('50 lines could not be read');
    expect(summary.message).toContain('and 47 more');
  });

  it('reports both kinds of problem when a file has both', () => {
    const summary = summariseLoad(
      report({
        refused: true,
        rows: [row({ verdict: 'conflict', storedRate: '0.085000', rate: '0.090000' })],
        issues: [{ line: 3, message: 'unreadable' }],
      }),
    );

    expect(summary.message).toContain('could not be read');

    expect(summary.message).toContain('already has a different rate');
  });

  describe('filling State, Local and RTA on rows already on file', () => {
    it('says how many rows a check would fill, between the counts and "Nothing was written"', () => {
      const summary = summariseLoad(
        report({ rows: [row(), filling('WA-3800'), filling('WA-9010')] }),
      );

      expect(summary.channel).toBe('notice');
      expect(summary.message).toBe(
        'Checked 3 rows: 1 new, 2 already on file. Loading fills in State, Local and RTA on ' +
          '2 rows. Nothing was written — choose the file again and press “Load these rates” to ' +
          'apply them.',
      );
    });

    it('says "on 1 row" when a check would fill one', () => {
      const message = summariseLoad(report({ rows: [filling('WA-3800')] })).message;

      expect(message).toContain('Loading fills in State, Local and RTA on 1 row.');
      expect(message).not.toContain('1 rows');
    });

    it('says how many rows a load filled', () => {
      expect(
        summariseLoad(report({ dryRun: false, inserted: 0, skipped: 12, filled: 12 })).message,
      ).toBe('Loaded 0 rates. 12 were already on file. Filled in State, Local and RTA on 12 rows.');
    });

    it('says "on 1 row" when a load filled one', () => {
      expect(
        summariseLoad(report({ dryRun: false, inserted: 0, skipped: 1, filled: 1 })).message,
      ).toBe('Loaded 0 rates. 1 was already on file. Filled in State, Local and RTA on 1 row.');
    });

    it('reads as it did before when nothing is filled', () => {
      const checked = summariseLoad(
        report({ rows: [row(), row({ jurisdiction: 'WA-3800', verdict: 'unchanged' })] }),
      ).message;
      expect(checked).toBe(
        'Checked 2 rows: 1 new, 1 already on file. Nothing was written — choose the file again ' +
          'and press “Load these rates” to apply them.',
      );

      expect(
        summariseLoad(report({ dryRun: false, inserted: 0, skipped: 2, filled: 0 })).message,
      ).toBe('Loaded 0 rates. 2 were already on file.');
    });
  });

  it('uses singular and plural correctly, because the banner is read by a person', () => {
    const one = summariseLoad(
      report({ refused: true, rows: [], issues: [{ line: 1, message: 'x' }] }),
    );
    expect(one.message).toContain('1 line could not be read');

    const two = summariseLoad(
      report({
        refused: true,
        rows: [],
        issues: [
          { line: 1, message: 'x' },
          { line: 2, message: 'y' },
        ],
      }),
    );
    expect(two.message).toContain('2 lines could not be read');
  });
});
