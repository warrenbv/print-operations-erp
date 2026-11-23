// Builds the request body that carries a rates file to the API, and refuses one too large before it is sent.
// Also used by apps/web/src/lib/post-too-large.ts for its refusal wording.
import type { TaxRateImportFormat } from '@erp/types';

/**
 * The largest JSON body the API accepts. apps/api/src/main.ts keeps the framework's default body
 * limit, and this mirrors it, so an oversized file gets a plain refusal here instead of a bare
 * error from the API.
 */
export const API_JSON_BODY_MAX_BYTES = 100 * 1024;

const BYTES_PER_KB = 1024;
const BYTES_PER_MB = 1024 * 1024;

export const LOAD_THE_RATES_FILE = 'Load the Rates file, named like Rates_YYQn.csv.';

export const NOTHING_TO_LOAD = 'Choose a file or paste some rows first.';

export function readableSize(bytes: number): string {
  if (bytes < BYTES_PER_MB) {
    return `${String(Math.ceil(bytes / BYTES_PER_KB))} KB`;
  }
  return `${(Math.ceil((bytes * 10) / BYTES_PER_MB) / 10).toFixed(1)} MB`;
}

function tooLarge(source: 'file' | 'pasted', bytes: number): string {
  const subject = source === 'file' ? 'That file is' : 'The pasted rows are';
  return `${subject} ${readableSize(bytes)}, which is too large to be a rates file. ${LOAD_THE_RATES_FILE}`;
}

function utf8Bytes(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

export type RatesBody = { readonly body: string } | { readonly refusal: string };

export async function ratesBody(
  file: FormDataEntryValue | null,
  pasted: FormDataEntryValue | null,
  format: TaxRateImportFormat,
  dryRun: boolean,
): Promise<RatesBody> {
  const chosen = file instanceof File && file.size > 0 ? file : undefined;
  if (chosen !== undefined && chosen.size > API_JSON_BODY_MAX_BYTES) {
    return { refusal: tooLarge('file', chosen.size) };
  }

  const fromFile = chosen !== undefined ? await chosen.text() : '';
  const text = fromFile !== '' ? fromFile : typeof pasted === 'string' ? pasted : '';
  if (text.trim() === '') {
    return { refusal: NOTHING_TO_LOAD };
  }

  // The file is checked again once wrapped, because JSON escaping can push a file under the limit over it.
  const body = JSON.stringify({ text, format, dryRun });
  if (utf8Bytes(body) > API_JSON_BODY_MAX_BYTES) {
    return {
      refusal:
        chosen !== undefined && fromFile !== ''
          ? tooLarge('file', chosen.size)
          : tooLarge('pasted', utf8Bytes(text)),
    };
  }
  return { body };
}
