// Tests the live address lookup adapter with a stubbed fetch: the request it sends, its timeout,
// and that every failure reads as `unreachable`. Subject:
// modules/quoting/src/adapters/dor-address-rates/dor-address-rates-lookup.ts.
import { describe, expect, it } from 'vitest';

import {
  DOR_LOOKUP_TIMEOUT_MS,
  DorAddressRatesLookup,
  type FetchLike,
} from '../src/adapters/dor-address-rates/dor-address-rates-lookup';

const ENDPOINT = 'https://dor.example.test/webapi/AddressRates.aspx';
const WAREHOUSE = { street: '200 Sample Road', city: 'Sample City', zip: '99000' };

function answering(body: string, ok = true): { fetch: FetchLike; urls: URL[] } {
  const urls: URL[] = [];
  return {
    urls,
    fetch: async (input) => {
      urls.push(input);
      return { ok, text: async () => body };
    },
  };
}

describe('DorAddressRatesLookup', () => {
  it('sends one GET with the documented four parameters and nothing else', async () => {
    const { fetch, urls } = answering('LocationCode=9010 Rate=0.087 ResultCode=0');
    await new DorAddressRatesLookup(ENDPOINT, fetch).locationFor({
      ...WAREHOUSE,
      zip: '990001234',
    });
    expect(urls).toHaveLength(1);
    const [url] = urls;
    expect(`${url?.origin}${url?.pathname}`).toBe(ENDPOINT);
    expect([...(url?.searchParams.entries() ?? [])]).toEqual([
      ['output', 'text'],
      ['addr', '200 Sample Road'],
      ['city', 'Sample City'],
      ['zip', '990001234'],
    ]);
  });

  it("reads the state's answer", async () => {
    const { fetch } = answering('LocationCode=9010 Rate=0.087 ResultCode=0\r\n');
    expect(await new DorAddressRatesLookup(ENDPOINT, fetch).locationFor(WAREHOUSE)).toEqual({
      kind: 'located',
      how: 'address',
      locationCode: '9010',
      stateRate: '0.087',
      resultCode: 0,
    });
  });

  it('is unreachable on an HTTP status that is not a success, whatever the body says', async () => {
    const { fetch } = answering('LocationCode=9010 Rate=0.087 ResultCode=0', false);
    expect(await new DorAddressRatesLookup(ENDPOINT, fetch).locationFor(WAREHOUSE)).toEqual({
      kind: 'unreachable',
      resultCode: undefined,
    });
  });

  it('is unreachable when the connection fails, and does not throw', async () => {
    const refused: FetchLike = async () => {
      throw new TypeError('fetch failed');
    };
    expect(await new DorAddressRatesLookup(ENDPOINT, refused).locationFor(WAREHOUSE)).toEqual({
      kind: 'unreachable',
      resultCode: undefined,
    });
  });

  it('is unreachable when the body cannot be read', async () => {
    const dropped: FetchLike = async () => ({
      ok: true,
      text: async () => {
        throw new TypeError('terminated');
      },
    });
    expect(await new DorAddressRatesLookup(ENDPOINT, dropped).locationFor(WAREHOUSE)).toEqual({
      kind: 'unreachable',
      resultCode: undefined,
    });
  });

  it('gives up at its time budget and answers unreachable', async () => {
    const silent: FetchLike = (_input, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(init.signal.reason));
      });
    const started = performance.now();
    const answer = await new DorAddressRatesLookup(ENDPOINT, silent, 50).locationFor(WAREHOUSE);
    expect(answer).toEqual({ kind: 'unreachable', resultCode: undefined });
    expect(performance.now() - started).toBeLessThan(2_000);
  });

  it('waits 5 seconds by default, the house figure for an SMTP connect', () => {
    expect(DOR_LOOKUP_TIMEOUT_MS).toBe(5_000);
  });

  it('is unreachable on an answer it does not recognise', async () => {
    const { fetch } = answering('<html><body>Maintenance</body></html>');
    expect(await new DorAddressRatesLookup(ENDPOINT, fetch).locationFor(WAREHOUSE)).toEqual({
      kind: 'unreachable',
      resultCode: undefined,
    });
  });
});
