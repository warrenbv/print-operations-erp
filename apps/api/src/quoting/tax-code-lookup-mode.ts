// Chooses the tax code lookup: live against an https URL, a fake for test runs, or off.
// The fake runs only on in-memory stores outside production. Off answers every address as unreachable and calls nothing.
import {
  DorAddressRatesLookup,
  InMemoryTaxCodeLookup,
  consoleTaxCodeLookupLog,
  type TaxCodeLookup,
  type TaxCodeLookupLog,
} from '@erp/quoting';

import { resolvePersistenceModeFromEnv } from '../config/persistence-guard';

export type TaxCodeLookupWiring =
  | { readonly kind: 'live'; readonly url: string }
  | { readonly kind: 'off' }
  | { readonly kind: 'fake' };

const URL_KEY = 'TAX_CODE_LOOKUP_URL';
const FAKE_KEY = 'E2E_TAX_CODE_LOOKUP';

export function describeTaxCodeLookup(env: NodeJS.ProcessEnv): TaxCodeLookupWiring {
  const raw = (env[URL_KEY] ?? '').trim();
  const flag = env[FAKE_KEY] ?? '';

  if (flag !== '') {
    if (flag !== 'fake') {
      throw new Error(`${FAKE_KEY} "${flag}" is not valid — set it to "fake" or leave it unset`);
    }
    if (raw !== '') {
      throw new Error(
        `${FAKE_KEY} is "fake" and ${URL_KEY} is set. Set one: the fake for a test run, ` +
          'the URL for a server that asks the state.',
      );
    }
    if (env.NODE_ENV === 'production') {
      throw new Error(refusal('NODE_ENV is "production"'));
    }
    const persistence = resolvePersistenceModeFromEnv(env);
    if (persistence !== 'memory') {
      throw new Error(refusal(`DATA_PERSISTENCE resolved to "${persistence}"`));
    }
    return { kind: 'fake' };
  }

  if (raw === '') {
    return { kind: 'off' };
  }
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(
      `${URL_KEY} must be an absolute URL such as ` +
        `https://webgis.dor.wa.gov/webapi/AddressRates.aspx, got "${raw}"`,
    );
  }
  if (parsed.protocol !== 'https:') {
    throw new Error(`${URL_KEY} must be an https URL, got "${raw}"`);
  }
  return { kind: 'live', url: raw };
}

export function createTaxCodeLookup(
  env: NodeJS.ProcessEnv = process.env,
  log: TaxCodeLookupLog = consoleTaxCodeLookupLog,
): TaxCodeLookup {
  const wiring = describeTaxCodeLookup(env);
  log.info({
    event: 'tax_code_lookup_selected',
    lookup: wiring.kind,
    ...(wiring.kind === 'live' ? { host: new URL(wiring.url).host } : {}),
  });
  switch (wiring.kind) {
    case 'live':
      return new DorAddressRatesLookup(wiring.url);
    case 'fake':
      return new InMemoryTaxCodeLookup();
    case 'off':
      return UNCONFIGURED;
  }
}

const UNCONFIGURED: TaxCodeLookup = {
  locationFor: async () => ({ kind: 'unreachable', resultCode: undefined }),
};

function refusal(cause: string): string {
  return (
    `${FAKE_KEY} is "fake" but ${cause}. The fake tax code lookup runs only on the ` +
    'in-memory stores, outside production: it answers for the state, which is a test ' +
    'fixture and never a thing a deployment should do.'
  );
}
