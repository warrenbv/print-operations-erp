// Finds the tax jurisdiction for a delivery address and reports the loaded rate for it. The address
// goes to the external lookup behind `TaxCodeLookup` in modules/quoting/src/ports.ts. The rate
// answered as `ourRate` comes from the imported rows, never from the lookup, whose own rate is
// passed through as `stateRate`. A code with no imported row is answered as `not_loaded`.
import type {
  TaxCodeLookupOutcome,
  TaxCodeLookupRequest,
  TaxCodeLookupResponse,
  TaxRate,
} from '@erp/types';

import type { TaxCodeLocation, TaxCodeLookup } from '../ports';

export interface TaxRateHistory {
  history(jurisdiction: string): Promise<readonly TaxRate[]>;
}

export interface TaxCodeLookupLog {
  info(line: Record<string, unknown>): void;
}

export const consoleTaxCodeLookupLog: TaxCodeLookupLog = {
  info: (line) => console.info(JSON.stringify(line)),
};

const ZIP = /^\d{5}(-?\d{4})?$/;

// The external lookup covers one state. An address in any other state is answered without a call.
const WASHINGTON = 'WA';

const LOCATED_OUTCOME = {
  address: 'matched',
  zip4: 'matched_zip4',
  corrected: 'corrected',
} as const satisfies Record<string, TaxCodeLookupOutcome>;

export class TaxCodeLookupService {
  readonly #lookup: TaxCodeLookup;
  readonly #rates: TaxRateHistory;
  readonly #log: TaxCodeLookupLog;
  readonly #now: () => number;

  constructor(
    lookup: TaxCodeLookup,
    rates: TaxRateHistory,
    options: {
      readonly log?: TaxCodeLookupLog;

      readonly now?: () => number;
    } = {},
  ) {
    this.#lookup = lookup;
    this.#rates = rates;
    this.#log = options.log ?? consoleTaxCodeLookupLog;
    this.#now = options.now ?? (() => performance.now());
  }

  async lookUp(request: TaxCodeLookupRequest, asOf: string): Promise<TaxCodeLookupResponse> {
    const started = this.#now();
    const { answer, resultCode } = await this.#answer(request, asOf);
    // One log line per lookup with the outcome and timing. The address is never logged.
    this.#log.info({
      event: 'tax-code-lookup',
      outcome: answer.outcome,
      resultCode: resultCode ?? null,
      locationCode: answer.locationCode ?? null,
      ms: Math.round(this.#now() - started),
    });
    return answer;
  }

  async #answer(
    request: TaxCodeLookupRequest,
    asOf: string,
  ): Promise<{ answer: TaxCodeLookupResponse; resultCode: number | undefined }> {
    const state = request.state.trim().toUpperCase();
    const street = request.line1.trim();
    const zip = request.postalCode.trim();
    if (state !== '' && state !== WASHINGTON) {
      return { answer: { outcome: 'not_washington' }, resultCode: undefined };
    }
    if (state === '' || street === '' || !ZIP.test(zip)) {
      return { answer: { outcome: 'incomplete_address' }, resultCode: undefined };
    }

    const location = await this.#lookup.locationFor({
      street,
      city: request.city.trim(),
      zip: zip.replace('-', ''),
    });
    return { answer: await this.#ourAnswer(location, asOf), resultCode: location.resultCode };
  }

  async #ourAnswer(location: TaxCodeLocation, asOf: string): Promise<TaxCodeLookupResponse> {
    if (location.kind === 'zip_only') {
      return { outcome: 'zip_only' };
    }
    if (location.kind === 'not_found') {
      return { outcome: 'not_found' };
    }
    if (location.kind === 'unreachable') {
      return { outcome: 'unavailable' };
    }
    const { locationCode, stateRate } = location;
    const key = `${WASHINGTON}-${locationCode}`;
    const row = namedRow(await this.#rates.history(key), asOf);
    if (row === undefined) {
      return { outcome: 'not_loaded', locationCode, key, stateRate };
    }
    return {
      outcome: LOCATED_OUTCOME[location.how],
      locationCode,
      key,
      ...(row.name === undefined ? {} : { name: row.name }),
      ourRate: row.rate,
      effectiveFrom: row.effectiveFrom,
      stateRate,
    };
  }
}

// The row in force on `asOf`, or else the earliest row that starts after it.
function namedRow(rows: readonly TaxRate[], asOf: string): TaxRate | undefined {
  let inForce: TaxRate | undefined;
  let next: TaxRate | undefined;
  for (const row of rows) {
    if (row.effectiveFrom <= asOf) {
      if (inForce === undefined || row.effectiveFrom > inForce.effectiveFrom) {
        inForce = row;
      }
    } else if (next === undefined || row.effectiveFrom < next.effectiveFrom) {
      next = row;
    }
  }
  return inForce ?? next;
}
