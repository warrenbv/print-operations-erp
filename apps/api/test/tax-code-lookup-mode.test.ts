// Tests the tax code lookup choice and its refusals in apps/api/src/quoting/tax-code-lookup-mode.ts.
import { DorAddressRatesLookup, InMemoryTaxCodeLookup } from '@erp/quoting';
import { describe, expect, it } from 'vitest';

import { createTaxCodeLookup, describeTaxCodeLookup } from '../src/quoting/tax-code-lookup-mode';

const DOR = 'https://webgis.dor.wa.gov/webapi/AddressRates.aspx';
const TEST_MEMORY = { NODE_ENV: 'test', DATA_PERSISTENCE: 'memory' };

describe('describeTaxCodeLookup', () => {
  it('is off with nothing set, or with both settings blank', () => {
    expect(describeTaxCodeLookup({})).toEqual({ kind: 'off' });
    expect(describeTaxCodeLookup({ TAX_CODE_LOOKUP_URL: ' ', E2E_TAX_CODE_LOOKUP: '' })).toEqual({
      kind: 'off',
    });
  });

  it('asks the state at the URL set', () => {
    expect(describeTaxCodeLookup({ TAX_CODE_LOOKUP_URL: DOR })).toEqual({ kind: 'live', url: DOR });
  });

  it('refuses a URL that is not absolute, or not https', () => {
    expect(() => describeTaxCodeLookup({ TAX_CODE_LOOKUP_URL: 'webgis.dor.wa.gov' })).toThrow(
      /must be an absolute URL/,
    );
    expect(() =>
      describeTaxCodeLookup({ TAX_CODE_LOOKUP_URL: DOR.replace('https:', 'http:') }),
    ).toThrow(/must be an https URL/);
  });

  it('answers from the fake on a test run in memory', () => {
    expect(describeTaxCodeLookup({ ...TEST_MEMORY, E2E_TAX_CODE_LOOKUP: 'fake' })).toEqual({
      kind: 'fake',
    });
  });

  it('refuses the fake in production, and on Postgres whatever NODE_ENV says', () => {
    expect(() =>
      describeTaxCodeLookup({
        ...TEST_MEMORY,
        NODE_ENV: 'production',
        E2E_TAX_CODE_LOOKUP: 'fake',
      }),
    ).toThrow(/NODE_ENV is "production"/);
    expect(() =>
      describeTaxCodeLookup({
        NODE_ENV: 'test',
        DATABASE_URL: 'postgresql://erp_app:x@localhost:5481/erp',
        E2E_TAX_CODE_LOOKUP: 'fake',
      }),
    ).toThrow(/DATA_PERSISTENCE resolved to "postgres"/);
  });

  it('refuses a flag that is not "fake" rather than reading it as off', () => {
    expect(() => describeTaxCodeLookup({ ...TEST_MEMORY, E2E_TAX_CODE_LOOKUP: 'true' })).toThrow(
      /E2E_TAX_CODE_LOOKUP "true" is not valid/,
    );
  });

  it('refuses the fake and a URL set together', () => {
    expect(() =>
      describeTaxCodeLookup({
        ...TEST_MEMORY,
        E2E_TAX_CODE_LOOKUP: 'fake',
        TAX_CODE_LOOKUP_URL: DOR,
      }),
    ).toThrow(/Set one/);
  });
});

describe('createTaxCodeLookup', () => {
  function created(env: NodeJS.ProcessEnv) {
    const lines: Record<string, unknown>[] = [];
    const lookup = createTaxCodeLookup(env, { info: (line) => lines.push(line) });
    return { lookup, lines };
  }

  it('builds the live adapter and says which host it asks, never the path', () => {
    const { lookup, lines } = created({ TAX_CODE_LOOKUP_URL: DOR });
    expect(lookup).toBeInstanceOf(DorAddressRatesLookup);
    expect(lines).toEqual([
      { event: 'tax_code_lookup_selected', lookup: 'live', host: 'webgis.dor.wa.gov' },
    ]);
  });

  it('builds the fake behind its gate', () => {
    const { lookup, lines } = created({ ...TEST_MEMORY, E2E_TAX_CODE_LOOKUP: 'fake' });
    expect(lookup).toBeInstanceOf(InMemoryTaxCodeLookup);
    expect(lines).toEqual([{ event: 'tax_code_lookup_selected', lookup: 'fake' }]);
  });

  it('answers unreachable when off, and sends nothing anywhere', async () => {
    const { lookup, lines } = created({});
    expect(lines).toEqual([{ event: 'tax_code_lookup_selected', lookup: 'off' }]);
    expect(
      await lookup.locationFor({ street: '200 Sample Road', city: 'Sample City', zip: '99000' }),
    ).toEqual({ kind: 'unreachable', resultCode: undefined });
  });
});
