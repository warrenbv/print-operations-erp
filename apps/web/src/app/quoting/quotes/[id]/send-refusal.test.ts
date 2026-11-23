// Tests the banner a refused send shows: the prefix chosen by the refusal's reason, with its gloss
// from apps/web/src/lib/api-error.ts.
import { describe, expect, it } from 'vitest';

import { readableApiError } from '../../../../lib/api-error';
import { sendRefusalPrefix } from './send-refusal';

const refusal = (body: unknown, status: number) => new Response(JSON.stringify(body), { status });

describe('the banner of a refused send', () => {
  it('says the quote was emailed when the send went out and was not recorded', async () => {
    const banner = await readableApiError(
      sendRefusalPrefix('send-not-recorded'),
      refusal({ reason: 'send-not-recorded', value: '<a@erp.example.test>' }, 500),
    );

    expect(banner).toBe(
      'Emailed, but not recorded: the email went out to the customer, but the ERP did not record that it was sent. Do not send it again. Give IT the quote number.',
    );
  });

  it('keeps the plain prefix for every refusal in which nothing went out', () => {
    for (const reason of ['relay-unreachable', 'relay-refused', 'stale-aggregate', undefined]) {
      expect(sendRefusalPrefix(reason)).toBe('Could not email the quote');
    }
  });
});
