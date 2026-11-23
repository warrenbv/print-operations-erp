// Tests for the tax-rate import parser, on two sample rate releases in packages/types/test/fixtures/.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { toDecimal } from '../src/decimal';
import {
  dorJurisdiction,
  parseDorRatesCsv,
  parseTaxRateImport,
  parseTaxRateRows,
} from '../src/tax-rate-import';

function fixture(name: string): string {
  return readFileSync(resolve(__dirname, 'fixtures', name), 'utf8');
}

const Q3 = fixture('dor-rates-26q3.csv');

const Q4 = fixture('dor-rates-26q4.csv');

describe('parseDorRatesCsv — the real Washington DOR release', () => {
  it('reads 26Q3 with no issues', () => {
    const { rows, issues } = parseDorRatesCsv(Q3);
    expect(issues).toEqual([]);
    expect(rows).toHaveLength(12);
  });

  it('reads Clarkston as WA-0202 at 8.5%, effective the quarter it starts', () => {
    const clarkston = parseDorRatesCsv(Q3).rows.find((row) => row.jurisdiction === 'WA-0202');
    expect(clarkston).toEqual({
      jurisdiction: 'WA-0202',
      rate: '0.085000',
      effectiveFrom: '2026-07-01',
      source: 'wa_dor',
      name: 'CLARKSTON',
      stateRate: '0.065000',
      localRate: '0.020000',
      rtaRate: '0.000000',
    });
  });

  it('pads a three-digit code, so 26Q3 and 26Q4 name the same jurisdictions', () => {
    const q3 = parseDorRatesCsv(Q3).rows.map((row) => row.jurisdiction);
    const q4 = parseDorRatesCsv(Q4).rows.map((row) => row.jurisdiction);

    expect(q3).toEqual(q4);
    expect(q3).toContain('WA-0202');
    expect(q3).not.toContain('WA-202');
  });

  it('reads 26Q4 despite its byte-order mark', () => {
    const { rows, issues } = parseDorRatesCsv(Q4);
    expect(issues).toEqual([]);
    expect(rows).toHaveLength(12);
    expect(rows[0]?.effectiveFrom).toBe('2026-10-01');
  });

  it('carries a rate change between quarters as a second row, never an edit', () => {
    const at = (text: string): string | undefined =>
      parseDorRatesCsv(text).rows.find((row) => row.jurisdiction === 'WA-1308')?.rate;

    expect(at(Q3)).toBe('0.084000');
    expect(at(Q4)).toBe('0.083000');
  });

  it('tolerates CRLF, because the file will have been through a Windows editor', () => {
    const { rows, issues } = parseDorRatesCsv(Q3.replace(/\n/g, '\r\n'));
    expect(issues).toEqual([]);
    expect(rows).toHaveLength(12);
  });

  it('refuses a file whose header is not a DOR release, naming every column it wanted', () => {
    const { rows, issues } = parseDorRatesCsv('Jurisdiction,Rate\nWA-9010,0.096\n');
    expect(rows).toEqual([]);
    expect(issues.every((issue) => issue.line === 1)).toBe(true);
    expect(issues.map((issue) => issue.message.match(/no "([^"]+)"/)?.[1])).toEqual([
      'Name',
      'Code',
      'State',
      'Local',
      'RTA',

      'Effective Date',
    ]);
    expect(issues[0]?.message).toContain('found: Jurisdiction, Rate');
  });

  it('reads columns by name, so a reordered release still lands correctly', () => {
    const reordered = [
      'Effective Date,Rate,Code,Name,State,Local,RTA,Expiration Date',
      '20260701,0.096,9010,SAMPLE CITY,0.065,0.031,0,20260930',
    ].join('\n');

    expect(parseDorRatesCsv(reordered).rows).toEqual([
      {
        jurisdiction: 'WA-9010',
        rate: '0.096000',
        effectiveFrom: '2026-07-01',
        source: 'wa_dor',
        name: 'SAMPLE CITY',
        stateRate: '0.065000',
        localRate: '0.031000',
        rtaRate: '0.000000',
      },
    ]);
  });

  it('refuses a row whose published total stops matching its own components', () => {
    const tampered = Q3.replace(
      'CLARKSTON,202,0.065,0.02,0,0.085,20260701,20260930',
      'CLARKSTON,202,0.065,0.02,0,0.097,20260701,20260930',
    );
    const { issues } = parseDorRatesCsv(tampered);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toContain('does not equal State + Local + RTA');
  });

  it('keeps State, Local and RTA beside the total on every row of 26Q3', () => {
    const rows = parseDorRatesCsv(Q3).rows;
    const tacoma = rows.find((row) => row.jurisdiction === 'WA-2717');
    expect(tacoma).toMatchObject({
      rate: '0.105000',
      stateRate: '0.065000',
      localRate: '0.040000',
      rtaRate: '0.000000',
    });

    expect(rows.every((row) => row.stateRate === '0.065000')).toBe(true);
    expect(rows.every((row) => row.rtaRate === '0.000000')).toBe(true);
  });

  it('keeps the parts from 26Q4 too, and they add up to the total on every row', () => {
    const rows = parseDorRatesCsv(Q4).rows;
    expect(rows).toHaveLength(12);
    for (const row of rows) {
      const summed = toDecimal(row.stateRate ?? 'missing')
        .plus(row.localRate ?? 'missing')
        .plus(row.rtaRate ?? 'missing');
      expect(summed.eq(row.rate)).toBe(true);
    }
    expect(rows.find((row) => row.jurisdiction === 'WA-1308')).toMatchObject({
      rate: '0.083000',
      localRate: '0.018000',
    });
  });

  it('stores no parts for a row with a blank part, and still loads its total', () => {
    const blank = Q3.replace(
      'CLARKSTON,202,0.065,0.02,0,0.085,20260701,20260930',
      'CLARKSTON,202,0.065,0.02,,0.085,20260701,20260930',
    );
    const { rows, issues } = parseDorRatesCsv(blank);
    expect(issues).toEqual([]);
    expect(rows.find((row) => row.jurisdiction === 'WA-0202')).toEqual({
      jurisdiction: 'WA-0202',
      rate: '0.085000',
      effectiveFrom: '2026-07-01',
      source: 'wa_dor',
      name: 'CLARKSTON',
    });
  });

  it('stores no parts when a part is finer than six places, and still loads its total', () => {
    const fine = Q3.replace(
      'CLARKSTON,202,0.065,0.02,0,0.085,20260701,20260930',
      'CLARKSTON,202,0.0648213,0.0201787,0,0.085,20260701,20260930',
    );
    const { rows, issues } = parseDorRatesCsv(fine);
    expect(issues).toEqual([]);
    const clarkston = rows.find((row) => row.jurisdiction === 'WA-0202');
    expect(clarkston?.rate).toBe('0.085000');
    expect(clarkston).not.toHaveProperty('stateRate');
    expect(clarkston).not.toHaveProperty('localRate');
    expect(clarkston).not.toHaveProperty('rtaRate');
  });

  it('names the line of a bad effective date and reads the rest', () => {
    const broken = Q3.replace('20260701,20260930\nOTHELLO', '2026-07-01,20260930\nOTHELLO');
    const { rows, issues } = parseDorRatesCsv(broken);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.line).toBe(2);
    expect(rows).toHaveLength(11);
  });

  it('refuses a location code that is not one the DOR could have published', () => {
    const { issues } = parseDorRatesCsv(
      'Name,Code,State,Local,RTA,Rate,Effective Date,Expiration Date\nSOMEWHERE,90100,0.065,0.031,0,0.096,20260701,20260930\n',
    );
    expect(issues[0]?.message).toContain('1 to 4 digits');
  });

  it('reports a duplicated jurisdiction rather than letting it read as a re-run', () => {
    const doubled = `${Q3}CLARKSTON,0202,0.065,0.02,0,0.085,20260701,20260930\n`;
    const { issues } = parseDorRatesCsv(doubled);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toContain('already given on line');
  });

  it('says so plainly when handed an empty file', () => {
    expect(parseDorRatesCsv('').issues[0]?.message).toBe('the file is empty');
  });
});

describe('dorJurisdiction', () => {
  it('pads to the DOR key width and prefixes the state', () => {
    expect(dorJurisdiction('202')).toBe('WA-0202');
    expect(dorJurisdiction('0202')).toBe('WA-0202');
    expect(dorJurisdiction('3800')).toBe('WA-3800');
  });
});

describe('parseTaxRateRows — our own four columns', () => {
  it('reads comma-separated rows with no header', () => {
    const { rows, issues } = parseTaxRateRows('WA-9010,0.096,2026-07-01,wa_dor\n');
    expect(issues).toEqual([]);
    expect(rows).toEqual([
      { jurisdiction: 'WA-9010', rate: '0.096000', effectiveFrom: '2026-07-01', source: 'wa_dor' },
    ]);
  });

  it('reads tab-separated rows, which is what a spreadsheet paste is', () => {
    const { rows, issues } = parseTaxRateRows('ID\t0.06\t2001-01-01\tstatute');
    expect(issues).toEqual([]);
    expect(rows[0]).toEqual({
      jurisdiction: 'ID',
      rate: '0.060000',
      effectiveFrom: '2001-01-01',
      source: 'statute',
    });
  });

  it('skips an optional header, blank lines and comments', () => {
    const text = [
      'jurisdiction,rate,effectiveFrom,source',
      '',
      '# the quarter starting July',
      'WA-9010,0.096,2026-07-01,wa_dor',
      '',
    ].join('\n');
    expect(parseTaxRateRows(text).rows).toHaveLength(1);
  });

  it('takes an optional fifth column as the display name', () => {
    const { rows } = parseTaxRateRows('WA-9010,0.096,2026-07-01,wa_dor,SAMPLE CITY');
    expect(rows[0]?.name).toBe('SAMPLE CITY');
  });

  it('normalises the rate to the stored scale, so a re-load is not a conflict', () => {
    expect(parseTaxRateRows('WA-9010,0.096,2026-07-01,wa_dor').rows[0]?.rate).toBe('0.096000');
  });

  it('catches a percent typed where a ratio belongs, and says which it wanted', () => {
    const { rows, issues } = parseTaxRateRows('WA-9010,9.6,2026-07-01,wa_dor');
    expect(rows).toEqual([]);
    expect(issues[0]?.message).toContain('0.085');
  });

  it('refuses a rate finer than the column stores', () => {
    expect(parseTaxRateRows('WA-9010,0.0962417,2026-07-01,wa_dor').issues[0]?.message).toContain(
      'decimal places',
    );
  });

  it('refuses a source outside the closed set', () => {
    const { issues } = parseTaxRateRows('WA-9010,0.096,2026-07-01,guessed');
    expect(issues).toHaveLength(1);
    expect(issues[0]?.line).toBe(1);
  });

  it('refuses a date that is not a calendar day', () => {
    expect(parseTaxRateRows('WA-9010,0.096,July 2026,wa_dor').issues).toHaveLength(1);
  });

  it('names the line of a wrong field count and keeps reading', () => {
    const { rows, issues } = parseTaxRateRows(
      ['WA-9010,0.096,2026-07-01,wa_dor', 'WA-9021,0.093', 'WA-9022,0.093,2026-07-01,wa_dor'].join(
        '\n',
      ),
    );
    expect(rows).toHaveLength(2);
    expect(issues[0]?.line).toBe(2);
    expect(issues[0]?.message).toContain('field(s)');
  });

  it('counts lines as a text editor does, blanks and comments included', () => {
    const { issues } = parseTaxRateRows(
      ['', '# a note', 'WA-9010,nonsense,2026-07-01,wa_dor'].join('\n'),
    );
    expect(issues[0]?.line).toBe(3);
  });

  it('reads nothing out of nothing without complaining', () => {
    expect(parseTaxRateRows('   \n\n')).toEqual({ rows: [], issues: [] });
  });
});

describe('parseTaxRateImport', () => {
  it('dispatches on the declared format', () => {
    expect(parseTaxRateImport(Q3, 'wa_dor_rates').rows).toHaveLength(12);
    expect(parseTaxRateImport('WA-9010,0.096,2026-07-01,wa_dor', 'erp_rows').rows).toHaveLength(1);
  });

  it('refuses a DOR file declared as our own rows, rather than half-reading it', () => {
    const { rows, issues } = parseTaxRateImport(Q3, 'erp_rows');
    expect(rows).toEqual([]);
    expect(issues.length).toBeGreaterThan(0);
  });
});
