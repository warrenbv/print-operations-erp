// Tests the tax rate load: verdicts per row, refusal of a conflicting load, dry runs, current rates
// and stale marking. Subject: modules/quoting/src/services/tax-rate-service.ts.
import { describe, expect, it } from 'vitest';

import { InMemoryTaxRateRepository } from '../src/adapters/in-memory/in-memory-tax-rate-repository';
import { TaxRateService } from '../src/services/tax-rate-service';

function service(): TaxRateService {
  return new TaxRateService(new InMemoryTaxRateRepository([]));
}

async function rateOn(
  rates: TaxRateService,
  jurisdiction: string,
  asOf: string,
): Promise<string | null> {
  return (
    (await rates.currentRates(asOf)).find((row) => row.jurisdiction === jurisdiction)?.rate ?? null
  );
}

const SAMPLE_CITY = 'WA-9020,0.077,2026-07-01,wa_dor,SAMPLE CITY';

describe('TaxRateService.isLoaded', () => {
  it('answers whether any rate is loaded for a key, at any effective date', async () => {
    const rates = service();
    await rates.load(
      [SAMPLE_CITY, 'WA-9040,0.106,2091-01-01,wa_dor,SAMPLE PORT'].join('\n'),
      'erp_rows',
      {
        dryRun: false,
      },
    );

    expect(await rates.isLoaded('WA-9020')).toBe(true);

    expect(await rates.isLoaded('WA-9040')).toBe(true);
    expect(await rates.isLoaded(' WA-9020 ')).toBe(true);
    expect(await rates.isLoaded('WA-9010')).toBe(false);
    expect(await rates.isLoaded('WA')).toBe(false);
  });
});

describe('TaxRateService.load', () => {
  it('previews without writing, and says what it would do per row', async () => {
    const rates = service();
    const preview = await rates.load(SAMPLE_CITY, 'erp_rows', { dryRun: true });

    expect(preview.dryRun).toBe(true);
    expect(preview.refused).toBe(false);
    expect(preview.rows).toEqual([
      {
        jurisdiction: 'WA-9020',
        rate: '0.077000',
        effectiveFrom: '2026-07-01',
        source: 'wa_dor',
        name: 'SAMPLE CITY',
        verdict: 'new',
      },
    ]);

    expect(preview.inserted).toBe(0);
    expect(await rates.currentRates('2026-08-01')).toEqual([]);
  });

  it('applies when asked, and the rate is then in force', async () => {
    const rates = service();
    const applied = await rates.load(SAMPLE_CITY, 'erp_rows', { dryRun: false });

    expect(applied).toMatchObject({ dryRun: false, refused: false, inserted: 1, skipped: 0 });
    expect(await rateOn(rates, 'WA-9020', '2026-08-01')).toBe('0.077000');
  });

  it('calls a re-loaded quarter unchanged, and writes nothing the second time', async () => {
    const rates = service();
    await rates.load(SAMPLE_CITY, 'erp_rows', { dryRun: false });
    const again = await rates.load(SAMPLE_CITY, 'erp_rows', { dryRun: false });

    expect(again.rows[0]?.verdict).toBe('unchanged');
    expect(again).toMatchObject({ refused: false, inserted: 0, skipped: 1 });
  });

  it('REFUSES a changed rate at a stored key, naming what is on file', async () => {
    const rates = service();
    await rates.load(SAMPLE_CITY, 'erp_rows', { dryRun: false });

    const corrected = await rates.load('WA-9020,0.088,2026-07-01,wa_dor', 'erp_rows', {
      dryRun: false,
    });

    expect(corrected.refused).toBe(true);
    expect(corrected.inserted).toBe(0);
    expect(corrected.rows[0]).toMatchObject({
      verdict: 'conflict',
      rate: '0.088000',
      storedRate: '0.077000',
    });

    expect(await rateOn(rates, 'WA-9020', '2026-08-01')).toBe('0.077000');
  });

  it('refuses the WHOLE load when one row conflicts, not just that row', async () => {
    const rates = service();
    await rates.load(SAMPLE_CITY, 'erp_rows', { dryRun: false });

    const mixed = await rates.load(
      ['WA-9020,0.088,2026-07-01,wa_dor', 'WA-9030,0.069,2026-07-01,wa_dor'].join('\n'),
      'erp_rows',
      { dryRun: false },
    );

    expect(mixed.refused).toBe(true);
    expect(mixed.rows.map((row) => row.verdict)).toEqual(['conflict', 'new']);
    expect(await rateOn(rates, 'WA-9030', '2026-08-01')).toBeNull();
  });

  it('refuses on a parse issue, because a part-readable file bills part of a state', async () => {
    const rates = service();
    const broken = await rates.load(
      ['WA-9020,0.077,2026-07-01,wa_dor', 'WA-9030,not-a-rate,2026-07-01,wa_dor'].join('\n'),
      'erp_rows',
      { dryRun: false },
    );

    expect(broken.refused).toBe(true);
    expect(broken.issues[0]?.line).toBe(2);
    expect(await rates.currentRates('2026-08-01')).toEqual([]);
  });

  it('refuses an empty load with a reason rather than reporting a clean nothing', async () => {
    const rates = service();
    const nothing = await rates.load('   \n\n', 'erp_rows', { dryRun: false });

    expect(nothing.refused).toBe(true);
    expect(nothing.issues[0]?.message).toContain('no rows');
  });

  it('lets a later quarter land beside the one already stored', async () => {
    const rates = service();
    await rates.load(SAMPLE_CITY, 'erp_rows', { dryRun: false });
    const q4 = await rates.load('WA-9020,0.074,2026-10-01,wa_dor', 'erp_rows', { dryRun: false });

    expect(q4).toMatchObject({ refused: false, inserted: 1 });
    expect(await rateOn(rates, 'WA-9020', '2026-09-30')).toBe('0.077000');
    expect(await rateOn(rates, 'WA-9020', '2026-10-01')).toBe('0.074000');
  });
});

describe('TaxRateService.currentRates', () => {
  it('flags a wa_dor rate from before the current quarter as stale', async () => {
    const rates = service();
    await rates.load(
      ['WA-9020,0.077,2026-07-01,wa_dor', 'WA-9030,0.069,2026-04-01,wa_dor'].join('\n'),
      'erp_rows',
      { dryRun: false },
    );

    const summary = await rates.currentRates('2026-08-28');
    expect(summary.map((row) => [row.jurisdiction, row.stale])).toEqual([
      ['WA-9020', false],
      ['WA-9030', true],
    ]);
  });

  it('never calls a statute rate stale, however old it is', async () => {
    const rates = service();
    await rates.load('ID,0.06,2001-01-01,statute', 'erp_rows', { dryRun: false });

    expect((await rates.currentRates('2026-08-28'))[0]).toMatchObject({
      jurisdiction: 'ID',
      stale: false,
    });
  });

  it('marks a jurisdiction the DOR retired, which nothing else would notice', async () => {
    const rates = service();
    await rates.load('WA-9999,0.102,2026-04-01,wa_dor', 'erp_rows', { dryRun: false });
    await rates.load('WA-9020,0.077,2026-07-01,wa_dor', 'erp_rows', { dryRun: false });

    const retired = (await rates.currentRates('2026-08-28')).find(
      (row) => row.jurisdiction === 'WA-9999',
    );
    expect(retired?.stale).toBe(true);
  });

  it('turns stale at the quarter boundary, not a day either side', async () => {
    const rates = service();
    await rates.load('WA-9020,0.077,2026-07-01,wa_dor', 'erp_rows', { dryRun: false });

    expect((await rates.currentRates('2026-09-30'))[0]?.stale).toBe(false);
    expect((await rates.currentRates('2026-10-01'))[0]?.stale).toBe(true);
  });
});

describe('TaxRateService.load reading the real DOR format', () => {
  it('loads a DOR release and refuses the same text read as our own rows', async () => {
    const release = [
      'Name,Code,State,Local,RTA,Rate,Effective Date,Expiration Date',
      'SAMPLE CITY,9020,0.065,0.012,0,0.077,20260701,20260930',
      'SAMPLE COUNTY,9030,0.065,0.004,0,0.069,20260701,20260930',
    ].join('\n');

    const rates = service();
    const loaded = await rates.load(release, 'wa_dor_rates', { dryRun: false });

    expect(loaded).toMatchObject({ refused: false, inserted: 2 });
    expect(await rateOn(rates, 'WA-9020', '2026-08-01')).toBe('0.077000');
    expect((await rates.currentRates('2026-08-01'))[0]?.name).toBe('SAMPLE CITY');

    expect((await service().load(release, 'erp_rows', { dryRun: true })).refused).toBe(true);
  });
});

describe('TaxRateService.load keeping State, Local and RTA', () => {
  const DOR_HEADER = 'Name,Code,State,Local,RTA,Rate,Effective Date,Expiration Date';
  const dor = (...lines: string[]): string => [DOR_HEADER, ...lines].join('\n');
  const SAMPLE_CITY_DOR = 'SAMPLE CITY,9020,0.065,0.012,0,0.077,20260701,20260930';
  const SAMPLE_COUNTY_DOR = 'SAMPLE COUNTY,9030,0.065,0.004,0,0.069,20260701,20260930';
  const SAMPLE_CITY_PARTS = {
    stateRate: '0.065000',
    localRate: '0.012000',
    rtaRate: '0.000000',
  } as const;

  const TYPED = 'WA-9020,0.077,2026-07-01,wa_dor,SAMPLE CITY BY HAND';

  it('stores the parts of a new row read from a DOR file', async () => {
    const rates = service();
    const loaded = await rates.load(dor(SAMPLE_CITY_DOR), 'wa_dor_rates', { dryRun: false });

    expect(loaded).toMatchObject({ refused: false, inserted: 1, skipped: 0, filled: 0 });
    expect((await rates.history('WA-9020'))[0]).toMatchObject(SAMPLE_CITY_PARTS);
  });

  it('fills the parts on a row typed without them, and leaves the rest as stored', async () => {
    const rates = service();
    await rates.load(TYPED, 'erp_rows', { dryRun: false });
    expect((await rates.history('WA-9020'))[0]).not.toHaveProperty('stateRate');

    const loaded = await rates.load(dor(SAMPLE_CITY_DOR), 'wa_dor_rates', { dryRun: false });

    expect(loaded).toMatchObject({ refused: false, inserted: 0, skipped: 1, filled: 1 });
    expect(loaded.rows[0]).toMatchObject({ verdict: 'unchanged', fillsParts: true });
    const history = await rates.history('WA-9020');
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      ...SAMPLE_CITY_PARTS,
      rate: '0.077000',
      name: 'SAMPLE CITY BY HAND',
      effectiveFrom: '2026-07-01',
      source: 'wa_dor',
    });
  });

  it('fills nothing on a second load of the same file', async () => {
    const rates = service();
    await rates.load(TYPED, 'erp_rows', { dryRun: false });
    await rates.load(dor(SAMPLE_CITY_DOR), 'wa_dor_rates', { dryRun: false });

    const again = await rates.load(dor(SAMPLE_CITY_DOR), 'wa_dor_rates', { dryRun: false });

    expect(again).toMatchObject({ refused: false, inserted: 0, skipped: 1, filled: 0 });
    expect(again.rows[0]?.verdict).toBe('unchanged');
    expect(again.rows[0]).not.toHaveProperty('fillsParts');
  });

  it('leaves a row whose parts are already stored alone, whatever the file says', async () => {
    const rates = service();
    await rates.load(dor(SAMPLE_CITY_DOR), 'wa_dor_rates', { dryRun: false });

    const other = await rates.load(
      dor('SAMPLE CITY,9020,0.048,0.029,0,0.077,20260701,20260930'),
      'wa_dor_rates',
      { dryRun: false },
    );

    expect(other).toMatchObject({ refused: false, filled: 0 });
    expect(other.rows[0]).not.toHaveProperty('fillsParts');
    expect((await rates.history('WA-9020'))[0]).toMatchObject(SAMPLE_CITY_PARTS);
  });

  it('refuses a file whose rate disagrees, and fills no part on any row', async () => {
    const rates = service();
    await rates.load(
      [TYPED, 'WA-9030,0.069,2026-07-01,wa_dor,SAMPLE COUNTY'].join('\n'),
      'erp_rows',
      { dryRun: false },
    );

    const refused = await rates.load(
      dor('SAMPLE CITY,9020,0.065,0.032,0,0.097,20260701,20260930', SAMPLE_COUNTY_DOR),
      'wa_dor_rates',
      { dryRun: false },
    );

    expect(refused).toMatchObject({ refused: true, inserted: 0, skipped: 0, filled: 0 });
    expect(refused.rows.map((row) => row.verdict)).toEqual(['conflict', 'unchanged']);
    expect((await rates.history('WA-9030'))[0]).not.toHaveProperty('stateRate');
    expect((await rates.history('WA-9020'))[0]).toMatchObject({ rate: '0.077000' });
    expect((await rates.history('WA-9020'))[0]).not.toHaveProperty('stateRate');
  });

  it('fills nothing on a dry run, and marks the rows it would fill', async () => {
    const rates = service();
    await rates.load(TYPED, 'erp_rows', { dryRun: false });

    const checked = await rates.load(dor(SAMPLE_CITY_DOR), 'wa_dor_rates', { dryRun: true });

    expect(checked).toMatchObject({ dryRun: true, refused: false, inserted: 0, filled: 0 });
    expect(checked.rows[0]).toMatchObject({
      verdict: 'unchanged',
      fillsParts: true,
      ...SAMPLE_CITY_PARTS,
    });
    expect((await rates.history('WA-9020'))[0]).not.toHaveProperty('stateRate');
  });
});
