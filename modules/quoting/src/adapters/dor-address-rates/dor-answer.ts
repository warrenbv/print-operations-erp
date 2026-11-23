// Reads the one-line text answer of the address-rates service into a `TaxCodeLocation`.
// The reader is strict. A second line, an unknown or repeated field, or a malformed code or rate
// makes the answer `unreachable`, never a partial result. The fixtures it is tested against are in
// modules/quoting/test/fixtures/dor-address-rates/.
import type { TaxCodeLocation } from '../../ports';

const LOCATED: Readonly<Record<number, 'address' | 'zip4' | 'corrected'>> = {
  0: 'address',
  1: 'zip4',
  2: 'corrected',
  3: 'corrected',
  4: 'corrected',
};
const ZIP_ONLY = 5;
const NOT_FOUND = 6;

const LOCATION_CODE = /^\d{1,4}$/;

const RATE = /^(?:0?\.\d{1,6}|0)$/;

export function readDorAnswer(text: string): TaxCodeLocation {
  const fields = fieldsOf(text);
  const rawResult = fields?.get('ResultCode');
  if (fields === undefined || rawResult === undefined || !/^\d+$/.test(rawResult)) {
    return { kind: 'unreachable', resultCode: undefined };
  }
  const resultCode = Number(rawResult);

  const how = LOCATED[resultCode];
  if (how !== undefined) {
    const code = fields.get('LocationCode');
    const rate = fields.get('Rate');
    if (code === undefined || !LOCATION_CODE.test(code) || rate === undefined || !RATE.test(rate)) {
      return { kind: 'unreachable', resultCode };
    }
    return {
      kind: 'located',
      how,
      locationCode: code.padStart(4, '0'),
      stateRate: rate.startsWith('.') ? `0${rate}` : rate,
      resultCode,
    };
  }
  if (resultCode === ZIP_ONLY) {
    return { kind: 'zip_only', resultCode };
  }
  if (resultCode === NOT_FOUND) {
    return { kind: 'not_found', resultCode };
  }

  return { kind: 'unreachable', resultCode };
}

const KNOWN_FIELDS: ReadonlySet<string> = new Set(['LocationCode', 'Rate', 'ResultCode']);

function fieldsOf(text: string): Map<string, string> | undefined {
  const line = text.replace(/^\uFEFF/, '').trim();
  if (line === '' || /[\r\n]/.test(line)) {
    return undefined;
  }
  const fields = new Map<string, string>();
  for (const pair of line.split(/\s+/)) {
    const match = /^([A-Za-z]+)=(\S*)$/.exec(pair);
    const name = match?.[1];
    const value = match?.[2];
    if (name === undefined || value === undefined || !KNOWN_FIELDS.has(name) || fields.has(name)) {
      return undefined;
    }
    fields.set(name, value);
  }
  return fields;
}
