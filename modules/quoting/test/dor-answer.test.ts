// Tests the address-rates answer reader against the synthetic fixtures in
// modules/quoting/test/fixtures/dor-address-rates/ and against answers it must refuse.
// Subject: modules/quoting/src/adapters/dor-address-rates/dor-answer.ts.
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { readDorAnswer } from '../src/adapters/dor-address-rates/dor-answer';
import type { TaxCodeLocation } from '../src/ports';

const FIXTURES = resolve(__dirname, 'fixtures/dor-address-rates');

interface Fixture {
  readonly source: string;
  readonly reads: TaxCodeLocation;
}

const NAMES = readdirSync(FIXTURES)
  .filter((file) => file.endsWith('.txt'))
  .map((file) => file.slice(0, -'.txt'.length))
  .sort();

describe('every answer in fixtures/dor-address-rates', () => {
  it('pairs each .txt with a .json, and the folder is not empty', () => {
    const json = readdirSync(FIXTURES)
      .filter((file) => file.endsWith('.json'))
      .map((file) => file.slice(0, -'.json'.length))
      .sort();
    expect(NAMES.length).toBeGreaterThan(0);
    expect(json).toEqual(NAMES);
  });

  it.each(NAMES)('%s reads as its .json says', (name) => {
    const text = readFileSync(resolve(FIXTURES, `${name}.txt`), 'utf8');
    const fixture = JSON.parse(readFileSync(resolve(FIXTURES, `${name}.json`), 'utf8')) as Fixture;
    expect(fixture.source).not.toBe('');
    expect(readDorAnswer(text)).toEqual(fixture.reads);
  });
});

describe('the documented result codes (not captured)', () => {
  it('reads 1 as the ZIP+4, and 2, 3 and 4 as a corrected address', () => {
    expect(readDorAnswer('LocationCode=9010 Rate=0.087 ResultCode=1')).toEqual({
      kind: 'located',
      how: 'zip4',
      locationCode: '9010',
      stateRate: '0.087',
      resultCode: 1,
    });
    for (const code of [2, 3, 4]) {
      expect(readDorAnswer(`LocationCode=9010 Rate=0.087 ResultCode=${code}`)).toMatchObject({
        kind: 'located',
        how: 'corrected',
        resultCode: code,
      });
    }
  });

  it('reads 5 as the ZIP only and 6 as no match, whatever the other two fields hold', () => {
    expect(readDorAnswer('LocationCode=-1 Rate=-1 ResultCode=5')).toEqual({
      kind: 'zip_only',
      resultCode: 5,
    });
    expect(readDorAnswer('LocationCode=0 Rate=0 ResultCode=6')).toEqual({
      kind: 'not_found',
      resultCode: 6,
    });
    expect(readDorAnswer('ResultCode=6')).toEqual({ kind: 'not_found', resultCode: 6 });
  });

  it('reads 7, 9 and a code DOR has not published as unreachable, keeping the code for the log', () => {
    for (const code of [7, 9, 8, 12]) {
      expect(readDorAnswer(`LocationCode=-1 Rate=-1 ResultCode=${code}`)).toEqual({
        kind: 'unreachable',
        resultCode: code,
      });
    }
  });

  it('pads a code DOR wrote without its leading zeros, as the rate loader does', () => {
    expect(readDorAnswer('LocationCode=97 Rate=0.071 ResultCode=0')).toMatchObject({
      locationCode: '0097',
    });
  });

  it('takes a byte-order mark, surrounding space and a trailing line ending', () => {
    expect(readDorAnswer('\uFEFF  LocationCode=9046 Rate=0.078 ResultCode=0\r\n')).toMatchObject({
      kind: 'located',
      locationCode: '9046',
    });
  });
});

describe('an answer the parser does not recognise is unreachable, never a fill', () => {
  it.each([
    ['an empty body', ''],
    ['an HTML error page', '<!DOCTYPE html><html><body>Service Unavailable</body></html>'],
    ['JSON', '{"LocationCode":9046,"Rate":0.078,"ResultCode":0}'],
    [
      'two lines',
      'LocationCode=9046 Rate=0.078 ResultCode=0\nLocationCode=9047 Rate=0.078 ResultCode=0',
    ],
    ['a field nobody documented', 'LocationCode=9046 Rate=0.078 ResultCode=0 Debug=1'],
    ['a field twice', 'LocationCode=9046 LocationCode=9047 Rate=0.078 ResultCode=0'],
    ['the field names in another case', 'locationcode=9046 rate=0.078 resultcode=0'],
    ['no result code', 'LocationCode=9046 Rate=0.078'],
    ['a result code that is not a number', 'LocationCode=9046 Rate=0.078 ResultCode=zero'],
  ])('%s', (_label, text) => {
    expect(readDorAnswer(text)).toEqual({ kind: 'unreachable', resultCode: undefined });
  });

  it.each([
    ['no location code', 'Rate=0.078 ResultCode=0'],
    ['a five-digit code', 'LocationCode=90460 Rate=0.078 ResultCode=0'],
    ['a negative code', 'LocationCode=-1 Rate=0.078 ResultCode=0'],
    ['no rate', 'LocationCode=9046 ResultCode=0'],
    ['a rate of 1 or more', 'LocationCode=9046 Rate=1.078 ResultCode=0'],
    ['a rate as a percent', 'LocationCode=9046 Rate=7.8 ResultCode=0'],
    ['a rate with seven places', 'LocationCode=9046 Rate=0.0780001 ResultCode=0'],
  ])('a located answer with %s', (_label, text) => {
    expect(readDorAnswer(text)).toEqual({ kind: 'unreachable', resultCode: 0 });
  });
});
