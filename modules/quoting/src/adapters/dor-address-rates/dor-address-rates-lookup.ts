// The live `TaxCodeLookup`: one GET to the configured address-rates endpoint, with a timeout. An
// HTTP failure, a timeout or an unreadable answer is `unreachable`, so nothing is filled from it.
// The API chooses this adapter or the in-memory one in
// apps/api/src/quoting/tax-code-lookup-mode.ts.
import type { TaxCodeAddress, TaxCodeLocation, TaxCodeLookup } from '../../ports';
import { readDorAnswer } from './dor-answer';

export const DOR_LOOKUP_TIMEOUT_MS = 5_000;

export type FetchLike = (
  input: URL,
  init: { readonly signal: AbortSignal; readonly headers: Record<string, string> },
) => Promise<Pick<Response, 'ok' | 'text'>>;

export class DorAddressRatesLookup implements TaxCodeLookup {
  readonly #endpoint: string;
  readonly #fetch: FetchLike;
  readonly #timeoutMs: number;

  constructor(
    endpoint: string,
    fetchFn: FetchLike = (input, init) => fetch(input, init),
    timeoutMs: number = DOR_LOOKUP_TIMEOUT_MS,
  ) {
    this.#endpoint = endpoint;
    this.#fetch = fetchFn;
    this.#timeoutMs = timeoutMs;
  }

  async locationFor(address: TaxCodeAddress): Promise<TaxCodeLocation> {
    const url = new URL(this.#endpoint);
    url.searchParams.set('output', 'text');
    url.searchParams.set('addr', address.street);
    url.searchParams.set('city', address.city);
    url.searchParams.set('zip', address.zip);
    try {
      const response = await this.#fetch(url, {
        signal: AbortSignal.timeout(this.#timeoutMs),
        headers: { accept: 'text/plain' },
      });
      if (!response.ok) {
        return { kind: 'unreachable', resultCode: undefined };
      }
      return readDorAnswer(await response.text());
    } catch {
      return { kind: 'unreachable', resultCode: undefined };
    }
  }
}
