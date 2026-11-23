// Tests the tax code lookup service on the in-memory lookup and tax rates: address checks before
// any call, which answers fill a jurisdiction, and one log line per lookup. Subject:
// modules/quoting/src/services/tax-code-lookup-service.ts.
import type { NewTaxRate, TaxCodeLookupRequest } from '@erp/types';
import { describe, expect, it } from 'vitest';

import { InMemoryTaxCodeLookup } from '../src/adapters/dor-address-rates/in-memory-tax-code-lookup';
import { InMemoryTaxRateRepository } from '../src/adapters/in-memory/in-memory-tax-rate-repository';
import type { TaxCodeLocation } from '../src/ports';
import { TaxCodeLookupService } from '../src/services/tax-code-lookup-service';
import { TaxRateService } from '../src/services/tax-rate-service';

const TODAY = '2026-11-16';

const WAREHOUSE: TaxCodeLookupRequest = {
  line1: '200 Sample Road',
  city: 'Sample City',
  postalCode: '99000',
  state: 'WA',
};

const SAMPLE_CITY_26Q4: NewTaxRate = {
  jurisdiction: 'WA-9010',
  rate: '0.087',
  effectiveFrom: '2026-10-01',
  source: 'wa_dor',
  name: 'SAMPLE CITY',
};

function located(
  how: 'address' | 'zip4' | 'corrected',
  locationCode = '9010',
  stateRate = '0.087',
): TaxCodeLocation {
  const resultCode = { address: 0, zip4: 1, corrected: 3 }[how];
  return { kind: 'located', how, locationCode, stateRate, resultCode };
}

async function setUp(options: {
  answer?: TaxCodeLocation;
  rates?: readonly NewTaxRate[];
}): Promise<{
  service: TaxCodeLookupService;
  fake: InMemoryTaxCodeLookup;
  rates: TaxRateService;
  lines: Record<string, unknown>[];
}> {
  const fake = new InMemoryTaxCodeLookup(
    options.answer === undefined ? {} : { [WAREHOUSE.line1]: options.answer },
  );
  const rates = new TaxRateService(new InMemoryTaxRateRepository());
  await rates.importRates(options.rates ?? []);
  const lines: Record<string, unknown>[] = [];
  let clock = 1_000;
  const service = new TaxCodeLookupService(fake, rates, {
    log: { info: (line) => lines.push(line) },
    now: () => (clock += 40),
  });
  return { service, fake, rates, lines };
}

describe('the address is checked before anyone is asked', () => {
  it('answers not_washington for another state, and sends nothing', async () => {
    const { service, fake } = await setUp({ answer: located('address') });
    expect(await service.lookUp({ ...WAREHOUSE, state: 'ID' }, TODAY)).toEqual({
      outcome: 'not_washington',
    });
    expect(fake.asked).toEqual([]);
  });

  it.each([
    ['no street', { line1: '  ' }],
    ['no ZIP', { postalCode: '' }],
    ['a ZIP of the wrong shape', { postalCode: '9800' }],
    ['no state', { state: '' }],
  ])('answers incomplete_address with %s, and sends nothing', async (_label, change) => {
    const { service, fake } = await setUp({ answer: located('address') });
    expect(await service.lookUp({ ...WAREHOUSE, ...change }, TODAY)).toEqual({
      outcome: 'incomplete_address',
    });
    expect(fake.asked).toEqual([]);
  });

  it('sends the street, the city and the ZIP digits, and nothing else', async () => {
    const { service, fake } = await setUp({ answer: located('address') });
    await service.lookUp(
      { line1: ' 200 Sample Road ', city: ' Sample City ', postalCode: '99000-3862', state: 'wa' },
      TODAY,
    );
    expect(fake.asked).toEqual([
      { street: '200 Sample Road', city: 'Sample City', zip: '990003862' },
    ]);
  });
});

describe('a located address with a loaded rate fills', () => {
  it('names our row in force today, beside the state rate', async () => {
    const { service } = await setUp({ answer: located('address'), rates: [SAMPLE_CITY_26Q4] });
    expect(await service.lookUp(WAREHOUSE, TODAY)).toEqual({
      outcome: 'matched',
      locationCode: '9010',
      key: 'WA-9010',
      name: 'SAMPLE CITY',
      ourRate: '0.087',
      effectiveFrom: '2026-10-01',
      stateRate: '0.087',
    });
  });

  it('reports the ZIP+4 and a corrected address as their own outcomes', async () => {
    const zip4 = await setUp({ answer: located('zip4'), rates: [SAMPLE_CITY_26Q4] });
    expect(await zip4.service.lookUp(WAREHOUSE, TODAY)).toMatchObject({
      outcome: 'matched_zip4',
      key: 'WA-9010',
    });
    const corrected = await setUp({ answer: located('corrected'), rates: [SAMPLE_CITY_26Q4] });
    expect(await corrected.service.lookUp(WAREHOUSE, TODAY)).toMatchObject({
      outcome: 'corrected',
      key: 'WA-9010',
    });
  });

  it("carries the state's rate when it differs from ours, so the page can name both", async () => {
    const { service } = await setUp({
      answer: located('address', '9010', '0.088'),
      rates: [SAMPLE_CITY_26Q4],
    });
    expect(await service.lookUp(WAREHOUSE, TODAY)).toMatchObject({
      ourRate: '0.087',
      stateRate: '0.088',
    });
  });

  it('leaves the name out when our row has none', async () => {
    const nameless: NewTaxRate = {
      jurisdiction: SAMPLE_CITY_26Q4.jurisdiction,
      rate: SAMPLE_CITY_26Q4.rate,
      effectiveFrom: SAMPLE_CITY_26Q4.effectiveFrom,
      source: SAMPLE_CITY_26Q4.source,
    };
    const { service } = await setUp({ answer: located('address'), rates: [nameless] });
    const answer = await service.lookUp(WAREHOUSE, TODAY);
    expect(answer.outcome).toBe('matched');
    expect(answer).not.toHaveProperty('name');
  });

  it('names the latest row on or before today when several have started', async () => {
    const { service } = await setUp({
      answer: located('address'),
      rates: [
        { ...SAMPLE_CITY_26Q4, effectiveFrom: '2026-07-01', rate: '0.085' },
        SAMPLE_CITY_26Q4,
      ],
    });
    expect(await service.lookUp(WAREHOUSE, TODAY)).toMatchObject({
      ourRate: '0.087',
      effectiveFrom: '2026-10-01',
    });
  });
});

describe('a code counts as loaded exactly as the save counts it', () => {
  it('fills from a row that starts later when none is in force yet, naming its date', async () => {
    const later = { ...SAMPLE_CITY_26Q4, effectiveFrom: '2091-01-01' };
    const { service, rates } = await setUp({ answer: located('address'), rates: [later] });
    expect(await service.lookUp(WAREHOUSE, TODAY)).toMatchObject({
      outcome: 'matched',
      key: 'WA-9010',
      ourRate: '0.087',
      effectiveFrom: '2091-01-01',
    });
    expect(await rates.isLoaded('WA-9010')).toBe(true);
  });

  it('names the row in force today over one that starts later', async () => {
    const { service } = await setUp({
      answer: located('address'),
      rates: [
        SAMPLE_CITY_26Q4,
        { ...SAMPLE_CITY_26Q4, effectiveFrom: '2027-01-01', rate: '0.095' },
      ],
    });
    expect(await service.lookUp(WAREHOUSE, TODAY)).toMatchObject({
      ourRate: '0.087',
      effectiveFrom: '2026-10-01',
    });
  });

  it('answers not_loaded, filling nothing, for a code with no row at any date', async () => {
    const { service, rates } = await setUp({
      answer: located('address', '9015', '0.078'),
      rates: [SAMPLE_CITY_26Q4],
    });
    expect(await service.lookUp(WAREHOUSE, TODAY)).toEqual({
      outcome: 'not_loaded',
      locationCode: '9015',
      key: 'WA-9015',
      stateRate: '0.078',
    });
    expect(await rates.isLoaded('WA-9015')).toBe(false);
  });
});

describe('what the state could not settle fills nothing', () => {
  it.each([
    ['the ZIP only', { kind: 'zip_only', resultCode: 5 }, 'zip_only'],
    ['no match', { kind: 'not_found', resultCode: 6 }, 'not_found'],
    ['an unreachable state', { kind: 'unreachable', resultCode: undefined }, 'unavailable'],
    ['an internal error', { kind: 'unreachable', resultCode: 9 }, 'unavailable'],
  ] as const)('%s', async (_label, answer, outcome) => {
    const { service } = await setUp({ answer, rates: [SAMPLE_CITY_26Q4] });
    expect(await service.lookUp(WAREHOUSE, TODAY)).toEqual({ outcome });
  });
});

describe('one log line per press', () => {
  it('names the outcome, the result code, the location code and the milliseconds', async () => {
    const { service, lines } = await setUp({
      answer: located('zip4'),
      rates: [SAMPLE_CITY_26Q4],
    });
    await service.lookUp(WAREHOUSE, TODAY);
    expect(lines).toEqual([
      {
        event: 'tax-code-lookup',
        outcome: 'matched_zip4',
        resultCode: 1,
        locationCode: '9010',
        ms: 40,
      },
    ]);
  });

  it('logs a press that sent nothing too, with no result code', async () => {
    const { service, lines } = await setUp({ answer: located('address') });
    await service.lookUp({ ...WAREHOUSE, line1: '' }, TODAY);
    expect(lines).toEqual([
      {
        event: 'tax-code-lookup',
        outcome: 'incomplete_address',
        resultCode: null,
        locationCode: null,
        ms: 40,
      },
    ]);
  });

  it('never carries the address', async () => {
    const { service, lines } = await setUp({
      answer: located('address'),
      rates: [SAMPLE_CITY_26Q4],
    });
    await service.lookUp({ ...WAREHOUSE, postalCode: '99000-4817' }, TODAY);
    const logged = JSON.stringify(lines);
    for (const part of ['Sample Road', 'Sample City', '99000', '4817']) {
      expect(logged).not.toContain(part);
    }
  });
});
