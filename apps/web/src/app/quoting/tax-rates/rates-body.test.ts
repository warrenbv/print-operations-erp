// Tests the size limits on a rates file or pasted rows, and the size wording.
import { describe, expect, it, vi } from 'vitest';

import { API_JSON_BODY_MAX_BYTES, NOTHING_TO_LOAD, ratesBody, readableSize } from './rates-body';

const KB = 1024;
const MB = 1024 * 1024;

const TOO_LARGE =
  'which is too large to be a rates file. Load the Rates file, named like Rates_YYQn.csv.';

function csv(bytes: number, name = 'Rates_26Q3.csv'): File {
  const row = 'MADE UP PLACE,9999,0.065,0.02,0,0.085,20990101,20990331\n';
  const text = row.repeat(Math.ceil(bytes / row.length)).slice(0, bytes);
  return new File([text], name, { type: 'text/csv' });
}

const ENVELOPE = JSON.stringify({ text: '', format: 'erp_rows', dryRun: true }).length;

describe('ratesBody', () => {
  it('posts the text, the layout and the dry run as the api reads them', async () => {
    const file = csv(2 * KB);
    const text = await file.text();

    await expect(ratesBody(file, null, 'wa_dor_rates', true)).resolves.toEqual({
      body: JSON.stringify({ text, format: 'wa_dor_rates', dryRun: true }),
    });
  });

  it('refuses a file over the limit in words, and never reads it', async () => {
    const file = csv(API_JSON_BODY_MAX_BYTES + 1);
    const read = vi.spyOn(file, 'text');

    await expect(ratesBody(file, null, 'wa_dor_rates', true)).resolves.toEqual({
      refusal: `That file is 101 KB, ${TOO_LARGE}`,
    });
    expect(read).not.toHaveBeenCalled();
  });

  it('names a 1 MB file in MB', async () => {
    const file = csv(MB);
    const read = vi.spyOn(file, 'text');

    await expect(ratesBody(file, null, 'wa_dor_rates', false)).resolves.toEqual({
      refusal: `That file is 1.0 MB, ${TOO_LARGE}`,
    });
    expect(read).not.toHaveBeenCalled();
  });

  it('posts a real rates file that has grown well past today’s 23 KB', async () => {
    const result = await ratesBody(csv(60 * KB), null, 'wa_dor_rates', true);

    expect('body' in result).toBe(true);
  });

  it('refuses a small file whose body grows past the limit once escaped', async () => {
    const file = new File(['"'.repeat(60 * KB)], 'Rates_26Q3.csv', { type: 'text/csv' });
    const read = vi.spyOn(file, 'text');

    await expect(ratesBody(file, null, 'wa_dor_rates', true)).resolves.toEqual({
      refusal: `That file is 60 KB, ${TOO_LARGE}`,
    });
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('posts a body of exactly the limit and refuses one byte more', async () => {
    const fits = 'a'.repeat(API_JSON_BODY_MAX_BYTES - ENVELOPE);
    const body = JSON.stringify({ text: fits, format: 'erp_rows', dryRun: true });
    expect(new TextEncoder().encode(body).byteLength).toBe(API_JSON_BODY_MAX_BYTES);

    await expect(ratesBody(null, fits, 'erp_rows', true)).resolves.toEqual({ body });

    await expect(ratesBody(null, `${fits}a`, 'erp_rows', true)).resolves.toEqual({
      refusal: `The pasted rows are 100 KB, ${TOO_LARGE}`,
    });
  });

  it('counts pasted rows in UTF-8 bytes, which is what the parser counts', async () => {
    await expect(ratesBody(null, 'é'.repeat(60_000), 'erp_rows', true)).resolves.toEqual({
      refusal: `The pasted rows are 118 KB, ${TOO_LARGE}`,
    });
  });

  it('takes the file over pasted rows, and pasted rows when the file box is empty', async () => {
    const file = csv(KB);
    const fromFile = await ratesBody(file, 'WA-0202,0.085,2026-07-01,wa_dor', 'erp_rows', true);
    expect(fromFile).toEqual({
      body: JSON.stringify({ text: await file.text(), format: 'erp_rows', dryRun: true }),
    });

    const empty = new File([], '', { type: 'application/octet-stream' });
    const pasted = 'WA-0202,0.085,2026-07-01,wa_dor';
    await expect(ratesBody(empty, pasted, 'erp_rows', true)).resolves.toEqual({
      body: JSON.stringify({ text: pasted, format: 'erp_rows', dryRun: true }),
    });
  });

  it('asks for a file or rows when there is nothing to load', async () => {
    await expect(ratesBody(null, null, 'erp_rows', true)).resolves.toEqual({
      refusal: NOTHING_TO_LOAD,
    });
    await expect(ratesBody(null, '  \n ', 'erp_rows', true)).resolves.toEqual({
      refusal: NOTHING_TO_LOAD,
    });
  });

  it('holds the api parser’s limit as measured on the wire', () => {
    expect(API_JSON_BODY_MAX_BYTES).toBe(102_400);
  });
});

describe('readableSize', () => {
  it('gives whole KB under a megabyte, rounded up', () => {
    expect(readableSize(102_401)).toBe('101 KB');
    expect(readableSize(60 * KB)).toBe('60 KB');
    expect(readableSize(MB - 1)).toBe('1024 KB');
  });

  it('gives MB to one decimal place from a megabyte, rounded up', () => {
    expect(readableSize(MB)).toBe('1.0 MB');
    expect(readableSize(26 * MB)).toBe('26.0 MB');
    expect(readableSize(26 * MB + 1)).toBe('26.1 MB');
  });
});
