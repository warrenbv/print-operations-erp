// The contract for `TaxRateRepository` in modules/quoting/src/services/tax-rate-service.ts. One set
// of assertions, run against the in-memory and the Drizzle adapter by
// modules/quoting/test/tax-rate-contracts.test.ts. It pins down rates by effective date, current
// rates, and imports that skip stored rows and fill missing parts. A failure means one adapter
// breaks a promise the other keeps: docs/process/verifying-agent-written-code.md.
import type { NewTaxRate, TaxRate } from '@erp/types';
import { describe, expect, it } from 'vitest';

import type { TaxRateRepository } from '../../src/services/tax-rate-service';

// The rate in force on a day, read the way the service reads it: through `currentRates`.
async function rateOn(
  repo: TaxRateRepository,
  jurisdiction: string,
  asOf: string,
): Promise<TaxRate | null> {
  return (await repo.currentRates(asOf)).find((row) => row.jurisdiction === jurisdiction) ?? null;
}

export function taxRateRepositoryContract(makeRepo: () => Promise<TaxRateRepository>): void {
  const wa = (effectiveFrom: string, rate: string): NewTaxRate => ({
    jurisdiction: 'WA-SAMPLE',
    rate,
    effectiveFrom,
    source: 'wa_dor',
  });

  describe('tax rate repository', () => {
    it('returns the rate in force on the day asked about', async () => {
      const repo = await makeRepo();
      await repo.importRates([wa('2026-01-01', '0.067000'), wa('2026-04-01', '0.104000')]);

      expect((await rateOn(repo, 'WA-SAMPLE', '2026-02-15'))?.rate).toBe('0.067000');
      expect((await rateOn(repo, 'WA-SAMPLE', '2026-05-15'))?.rate).toBe('0.104000');
    });

    it('applies a new rate ON its effective date, not the day after', async () => {
      const repo = await makeRepo();
      await repo.importRates([wa('2026-01-01', '0.067000'), wa('2026-04-01', '0.104000')]);

      expect((await rateOn(repo, 'WA-SAMPLE', '2026-03-31'))?.rate).toBe('0.067000');
      expect((await rateOn(repo, 'WA-SAMPLE', '2026-04-01'))?.rate).toBe('0.104000');
    });

    it('has no rate before the earliest one takes effect', async () => {
      const repo = await makeRepo();
      await repo.importRates([wa('2026-04-01', '0.104000')]);

      expect(await rateOn(repo, 'WA-SAMPLE', '2026-03-31')).toBeNull();
    });

    it('knows nothing about a jurisdiction it has never been given', async () => {
      const repo = await makeRepo();
      await repo.importRates([wa('2026-01-01', '0.067000')]);

      expect(await rateOn(repo, 'WA-9040', '2026-06-01')).toBeNull();
    });

    it('keeps jurisdictions apart', async () => {
      const repo = await makeRepo();
      await repo.importRates([
        wa('2026-01-01', '0.067000'),
        { jurisdiction: 'ID', rate: '0.060000', effectiveFrom: '2001-01-01', source: 'statute' },
      ]);

      expect((await rateOn(repo, 'ID', '2026-06-01'))?.rate).toBe('0.060000');
      expect((await rateOn(repo, 'WA-SAMPLE', '2026-06-01'))?.rate).toBe('0.067000');
    });

    it('re-importing a quarter changes nothing and says so', async () => {
      const repo = await makeRepo();
      const quarter = [wa('2026-01-01', '0.067000'), wa('2026-04-01', '0.104000')];

      expect(await repo.importRates(quarter)).toEqual({ inserted: 2, skipped: 0, filled: 0 });
      expect(await repo.importRates(quarter)).toEqual({ inserted: 0, skipped: 2, filled: 0 });
      expect(await repo.history('WA-SAMPLE')).toHaveLength(2);
    });

    it('lets a quarter be added beside one already stored', async () => {
      const repo = await makeRepo();
      await repo.importRates([wa('2026-01-01', '0.067000')]);

      expect(
        await repo.importRates([wa('2026-01-01', '0.067000'), wa('2026-07-01', '0.101000')]),
      ).toEqual({ inserted: 1, skipped: 1, filled: 0 });
      expect((await rateOn(repo, 'WA-SAMPLE', '2026-08-01'))?.rate).toBe('0.101000');
    });

    it('reads a rate history newest first', async () => {
      const repo = await makeRepo();
      await repo.importRates([wa('2026-01-01', '0.067000'), wa('2026-04-01', '0.104000')]);

      expect((await repo.history('WA-SAMPLE')).map((row) => row.effectiveFrom)).toEqual([
        '2026-04-01',
        '2026-01-01',
      ]);
    });

    it('keeps the source, because the two age differently', async () => {
      const repo = await makeRepo();
      await repo.importRates([
        wa('2026-01-01', '0.067000'),
        { jurisdiction: 'ID', rate: '0.060000', effectiveFrom: '2001-01-01', source: 'statute' },
      ]);

      expect((await rateOn(repo, 'ID', '2026-06-01'))?.source).toBe('statute');
      expect((await rateOn(repo, 'WA-SAMPLE', '2026-06-01'))?.source).toBe('wa_dor');
    });

    it('imports nothing without complaint', async () => {
      const repo = await makeRepo();
      expect(await repo.importRates([])).toEqual({ inserted: 0, skipped: 0, filled: 0 });
    });

    it('carries the DOR name alongside the code, and tolerates its absence', async () => {
      const repo = await makeRepo();
      await repo.importRates([
        { ...wa('2026-07-01', '0.079000'), name: 'SAMPLE CITY' },
        { jurisdiction: 'ID', rate: '0.060000', effectiveFrom: '2001-01-01', source: 'statute' },
      ]);

      expect((await rateOn(repo, 'WA-SAMPLE', '2026-08-01'))?.name).toBe('SAMPLE CITY');
      expect((await rateOn(repo, 'ID', '2026-08-01'))?.name).toBeUndefined();
    });

    it('does NOT overwrite a stored rate when the same quarter comes back changed', async () => {
      const repo = await makeRepo();
      await repo.importRates([wa('2026-07-01', '0.079000')]);

      expect(await repo.importRates([wa('2026-07-01', '0.072000')])).toEqual({
        inserted: 0,
        skipped: 1,
        filled: 0,
      });
      expect((await rateOn(repo, 'WA-SAMPLE', '2026-08-01'))?.rate).toBe('0.079000');
    });

    describe('State, Local and RTA', () => {
      const SAMPLE_TOWN_PARTS = {
        stateRate: '0.065000',
        localRate: '0.013000',
        rtaRate: '0.000000',
      } as const;
      const sampleTown = (parts: boolean): NewTaxRate => ({
        jurisdiction: 'WA-9020',
        rate: '0.078000',
        effectiveFrom: '2026-07-01',
        source: 'wa_dor',
        name: 'SAMPLE TOWN',
        ...(parts ? SAMPLE_TOWN_PARTS : {}),
      });

      it('keeps the three parts a row carries, and none for a row without them', async () => {
        const repo = await makeRepo();
        await repo.importRates([sampleTown(true), wa('2026-07-01', '0.098000')]);

        expect(await rateOn(repo, 'WA-9020', '2026-08-01')).toMatchObject(SAMPLE_TOWN_PARTS);
        expect((await repo.history('WA-9020'))[0]).toMatchObject(SAMPLE_TOWN_PARTS);
        expect(
          (await repo.currentRates('2026-08-01')).find((row) => row.jurisdiction === 'WA-9020'),
        ).toMatchObject(SAMPLE_TOWN_PARTS);

        const sampleCity = await rateOn(repo, 'WA-SAMPLE', '2026-08-01');
        expect(sampleCity).not.toHaveProperty('stateRate');
        expect(sampleCity).not.toHaveProperty('localRate');
        expect(sampleCity).not.toHaveProperty('rtaRate');
      });

      it('fills the parts on a stored row that has none, at the same rate, and nothing else', async () => {
        const repo = await makeRepo();
        await repo.importRates([sampleTown(false)]);

        expect(
          await repo.importRates([
            { ...sampleTown(true), name: 'SAMPLE TOWN WEST', source: 'statute' },
          ]),
        ).toEqual({ inserted: 0, skipped: 1, filled: 1 });

        const [stored, ...rest] = await repo.history('WA-9020');
        expect(rest).toEqual([]);
        expect(stored).toMatchObject({
          ...SAMPLE_TOWN_PARTS,
          rate: '0.078000',
          effectiveFrom: '2026-07-01',
          source: 'wa_dor',
          name: 'SAMPLE TOWN',
        });

        expect(await repo.importRates([sampleTown(true)])).toEqual({
          inserted: 0,
          skipped: 1,
          filled: 0,
        });
      });

      it('leaves stored parts alone, and fills nothing beside a different rate', async () => {
        const repo = await makeRepo();
        await repo.importRates([sampleTown(true), wa('2026-07-01', '0.079000')]);

        expect(
          await repo.importRates([
            {
              ...sampleTown(false),
              stateRate: '0.069000',
              localRate: '0.009000',
              rtaRate: '0.000000',
            },
          ]),
        ).toEqual({ inserted: 0, skipped: 1, filled: 0 });
        expect(await rateOn(repo, 'WA-9020', '2026-08-01')).toMatchObject(SAMPLE_TOWN_PARTS);

        expect(
          await repo.importRates([
            {
              ...wa('2026-07-01', '0.099000'),
              stateRate: '0.065000',
              localRate: '0.034000',
              rtaRate: '0.000000',
            },
          ]),
        ).toEqual({ inserted: 0, skipped: 1, filled: 0 });
        const sampleCity = await rateOn(repo, 'WA-SAMPLE', '2026-08-01');
        expect(sampleCity?.rate).toBe('0.079000');
        expect(sampleCity).not.toHaveProperty('stateRate');
      });

      it('refuses parts that are partial or do not add up to the rate, and writes nothing', async () => {
        const repo = await makeRepo();

        await expect(
          repo.importRates([
            wa('2026-01-01', '0.067000'),
            { ...sampleTown(false), stateRate: '0.065000' },
          ]),
        ).rejects.toThrow();
        await expect(
          repo.importRates([
            wa('2026-01-01', '0.067000'),
            { ...sampleTown(true), localRate: '0.041000' },
          ]),
        ).rejects.toThrow();

        expect(await repo.history('WA-SAMPLE')).toEqual([]);
        expect(await repo.history('WA-9020')).toEqual([]);

        await repo.importRates([sampleTown(false)]);
        await expect(
          repo.importRates([{ ...sampleTown(true), localRate: '0.041000' }]),
        ).rejects.toThrow();
        expect(await rateOn(repo, 'WA-9020', '2026-08-01')).not.toHaveProperty('stateRate');
      });
    });

    describe('currentRates', () => {
      const washington = (rows: readonly { jurisdiction: string }[]): readonly string[] =>
        rows.map((row) => row.jurisdiction).filter((code) => code.startsWith('WA-'));

      it('answers one row per jurisdiction: the rate in force that day', async () => {
        const repo = await makeRepo();
        await repo.importRates([
          wa('2026-01-01', '0.067000'),
          wa('2026-07-01', '0.079000'),
          {
            jurisdiction: 'WA-9020',
            rate: '0.087000',
            effectiveFrom: '2026-07-01',
            source: 'wa_dor',
          },
        ]);

        const rows = await repo.currentRates('2026-08-01');
        expect(washington(rows)).toEqual(['WA-9020', 'WA-SAMPLE']);
        expect(rows.find((row) => row.jurisdiction === 'WA-SAMPLE')?.rate).toBe('0.079000');
        expect(rows.find((row) => row.jurisdiction === 'WA-9020')?.rate).toBe('0.087000');
      });

      it('reads the earlier quarter when asked about an earlier day', async () => {
        const repo = await makeRepo();
        await repo.importRates([wa('2026-01-01', '0.067000'), wa('2026-07-01', '0.079000')]);

        const sampleCity = (await repo.currentRates('2026-03-15')).find(
          (row) => row.jurisdiction === 'WA-SAMPLE',
        );
        expect(sampleCity?.rate).toBe('0.067000');
      });

      it('omits a jurisdiction whose first rate has not started yet', async () => {
        const repo = await makeRepo();
        await repo.importRates([wa('2026-07-01', '0.079000')]);

        expect(washington(await repo.currentRates('2026-06-30'))).toEqual([]);
      });

      it('sorts by jurisdiction, so the screen renders the same list either way', async () => {
        const repo = await makeRepo();
        await repo.importRates([
          {
            jurisdiction: 'WA-9030',
            rate: '0.096000',
            effectiveFrom: '2026-07-01',
            source: 'wa_dor',
          },
          { jurisdiction: 'ID', rate: '0.060000', effectiveFrom: '2001-01-01', source: 'statute' },
          {
            jurisdiction: 'WA-9020',
            rate: '0.078000',
            effectiveFrom: '2026-07-01',
            source: 'wa_dor',
          },
        ]);

        const rows = await repo.currentRates('2026-08-01');
        expect(rows.map((row) => row.jurisdiction)).toEqual(['ID', 'WA-9020', 'WA-9030']);
      });

      it('has nothing to say about a day before any rate existed', async () => {
        const repo = await makeRepo();
        await repo.importRates([wa('2026-07-01', '0.079000')]);

        expect(await repo.currentRates('2000-12-31')).toEqual([]);
      });
    });

    describe('existingFor', () => {
      it('matches on the exact key, never on "latest before"', async () => {
        const repo = await makeRepo();
        await repo.importRates([wa('2026-01-01', '0.067000')]);

        expect(
          await repo.existingFor([{ jurisdiction: 'WA-SAMPLE', effectiveFrom: '2026-07-01' }]),
        ).toEqual([]);
        expect(
          (await repo.existingFor([{ jurisdiction: 'WA-SAMPLE', effectiveFrom: '2026-01-01' }]))[0]
            ?.rate,
        ).toBe('0.067000');
      });

      it('answers only the pairs asked for, not the cross-product', async () => {
        const repo = await makeRepo();
        await repo.importRates([
          {
            jurisdiction: 'WA-9020',
            rate: '0.078000',
            effectiveFrom: '2026-07-01',
            source: 'wa_dor',
          },
          {
            jurisdiction: 'WA-9030',
            rate: '0.096000',
            effectiveFrom: '2026-04-01',
            source: 'wa_dor',
          },
        ]);

        const found = await repo.existingFor([
          { jurisdiction: 'WA-9020', effectiveFrom: '2026-07-01' },
          { jurisdiction: 'WA-9030', effectiveFrom: '2026-07-01' },
        ]);
        expect(found.map((row) => row.jurisdiction)).toEqual(['WA-9020']);
      });

      it('asks nothing of the database for an empty key list', async () => {
        const repo = await makeRepo();
        expect(await repo.existingFor([])).toEqual([]);
      });
    });
  });
}
