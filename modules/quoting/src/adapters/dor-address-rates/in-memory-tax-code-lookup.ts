// A canned `TaxCodeLookup` for tests and browser runs, with fictional answers keyed by street.
// The API uses it only on in-memory storage outside production:
// apps/api/src/quoting/tax-code-lookup-mode.ts.
import type { TaxCodeAddress, TaxCodeLocation, TaxCodeLookup } from '../../ports';

export const FAKE_TAX_CODE_ANSWERS: Readonly<Record<string, TaxCodeLocation>> = {
  '200 SAMPLE ROAD': {
    kind: 'located',
    how: 'address',
    locationCode: '9010',
    stateRate: '0.087',
    resultCode: 0,
  },
  '1 ZIP PLUS FOUR WAY': {
    kind: 'located',
    how: 'zip4',
    locationCode: '9010',
    stateRate: '0.087',
    resultCode: 1,
  },
  '1 CORRECTED WAY': {
    kind: 'located',
    how: 'corrected',
    locationCode: '9010',
    stateRate: '0.087',
    resultCode: 2,
  },
  '1 NEW QUARTER WAY': {
    kind: 'located',
    how: 'address',
    locationCode: '9010',
    stateRate: '0.088',
    resultCode: 0,
  },
  '1 UNLOADED CODE WAY': {
    kind: 'located',
    how: 'address',
    locationCode: '9015',
    stateRate: '0.078',
    resultCode: 0,
  },
  '1 ZIP ONLY WAY': { kind: 'zip_only', resultCode: 5 },
  '1 UNREACHABLE WAY': { kind: 'unreachable', resultCode: undefined },
};

export class InMemoryTaxCodeLookup implements TaxCodeLookup {
  readonly #answers: ReadonlyMap<string, TaxCodeLocation>;

  // Every address asked, so a test can assert what was sent.
  readonly asked: TaxCodeAddress[] = [];

  constructor(answers: Readonly<Record<string, TaxCodeLocation>> = FAKE_TAX_CODE_ANSWERS) {
    this.#answers = new Map(Object.entries(answers).map(([street, at]) => [fold(street), at]));
  }

  async locationFor(address: TaxCodeAddress): Promise<TaxCodeLocation> {
    this.asked.push(address);
    return this.#answers.get(fold(address.street)) ?? { kind: 'not_found', resultCode: 6 };
  }
}

function fold(street: string): string {
  return street.trim().replace(/\s+/g, ' ').toUpperCase();
}
