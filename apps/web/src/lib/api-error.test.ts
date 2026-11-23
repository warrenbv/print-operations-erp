// Tests how apps/web/src/lib/api-error.ts turns refusals, validation errors and bare statuses into banner text.
import { DOCUMENT_STORAGE_FAILURES } from '@erp/types';
import { describe, expect, it } from 'vitest';

import {
  REASON_FIGURES_GLOSS,
  REASON_GLOSS,
  REASON_VALUE_GLOSS,
  readableApiError,
} from './api-error';

function conflict(body: unknown, status = 409): Response {
  return new Response(JSON.stringify(body), { status });
}

describe('readableApiError', () => {
  it('glosses a credit-hold refusal into something a salesperson can act on', async () => {
    const detail = await readableApiError(
      'Quote could not be created',
      conflict({
        reason: 'customer-on-credit-hold',
        value: '01a01c61-0000-7000-8000-0000000000a1',
        message: 'customer is on credit hold',
      }),
    );

    expect(detail).toContain('on credit hold');

    expect(detail).toContain('Billing Manager');
    expect(detail).not.toContain('customer-on-credit-hold');
  });

  it('glosses the approval-side mirror too', async () => {
    const detail = await readableApiError(
      'Approval failed',
      conflict({ reason: 'customer-not-on-credit-hold', value: 'x' }),
    );

    expect(detail).toContain('no exception to approve');
    expect(detail).not.toContain('customer-not-on-credit-hold');
  });

  it('glosses the billing-address refusal, the third quote-time entry', async () => {
    const detail = await readableApiError(
      'Quote could not be created',
      conflict({ reason: 'customer-billing-address-required', value: 'x' }),
    );

    expect(detail).toContain('no billing address');

    expect(detail).toContain('edit it, add the billing address');
    expect(detail).not.toContain('customer-billing-address-required');
  });

  it('keeps an unmapped reason rather than swallowing it', async () => {
    const detail = await readableApiError('Save failed', conflict({ reason: 'brand-new-reason' }));

    expect(detail).toBe('Save failed: brand-new-reason');
  });

  it('says what a 500 means rather than printing its number', async () => {
    const detail = await readableApiError('Save failed', new Response('', { status: 500 }));

    expect(detail).toContain('something went wrong on the server');
    expect(detail).toContain('tell IT');
    expect(detail).not.toContain('500');
  });

  it('says nothing extra when an unknown status arrives with no body', async () => {
    expect(await readableApiError('Save failed', new Response('', { status: 502 }))).toBe(
      'Save failed.',
    );
  });

  it('falls back to raw text when the body is not JSON', async () => {
    const detail = await readableApiError(
      'Save failed',
      new Response('upstream exploded', { status: 502 }),
    );

    expect(detail).toBe('Save failed: upstream exploded');
  });
});

describe('the lead-time refusal', () => {
  it('sends the lead time to Production, the only desk that enters one', async () => {
    const detail = await readableApiError(
      'Could not send that quote',
      conflict({ reason: 'quote-needs-lead-time', message: 'lead time required' }),
    );
    expect(detail).toContain('Ask Production to enter it on the quote');
    expect(detail).not.toContain('enter one on the quote');
  });
});

function badRequest(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 400 });
}

describe('readableApiError on a validation failure', () => {
  it('names the field instead of printing the flatten', async () => {
    const detail = await readableApiError(
      'Could not save the grade',
      badRequest({
        formErrors: [],
        fieldErrors: { basisWeightLb: ['expected a decimal with at most 4 places'] },
      }),
    );

    expect(detail).toBe(
      'Could not save the grade: Basis weight (lb): expected a decimal with at most 4 places',
    );
    expect(detail).not.toContain('basisWeightLb');
    expect(detail).not.toContain('fieldErrors');
  });

  it('names EVERY bad field, not just the first', async () => {
    const detail = await readableApiError(
      'Save failed',
      badRequest({
        formErrors: [],
        fieldErrors: {
          basisWeightLb: ['cannot be negative'],
          reamAreaDivisor: ['cannot be negative'],
          orderLineId: ['String must contain at least 1 character(s)'],
        },
      }),
    );

    expect(detail).toContain('Basis weight (lb): cannot be negative');
    expect(detail).toContain('Ream area divisor: cannot be negative');

    expect(detail).toContain('Order line id: String must contain at least 1 character(s)');
  });

  it('leads with the form-level message, which is about the whole request', async () => {
    const detail = await readableApiError(
      'Could not save the grade',
      badRequest({
        formErrors: ['a grade must offer at least one footage variant'],
        fieldErrors: { basisWeightLb: ['see above'] },
      }),
    );

    expect(detail).toBe(
      'Could not save the grade: a grade must offer at least one footage variant; ' +
        'Basis weight (lb): see above',
    );
  });

  it('reads zod bare "Required" as a sentence', async () => {
    const detail = await readableApiError(
      'Could not save the customer',
      badRequest({ formErrors: [], fieldErrors: { billingAddress: ['Required'] } }),
    );

    expect(detail).toBe('Could not save the customer: Billing address is required');
  });

  it('renders the issues array Nest wraps under `message`', async () => {
    const detail = await readableApiError(
      'Could not save the tier',
      badRequest({
        message: [
          {
            code: 'custom',
            message: 'expected a decimal with at most 4 places',
            path: ['marginPct'],
          },
        ],
        error: 'Bad Request',
        statusCode: 400,
      }),
    );

    expect(detail).toBe(
      'Could not save the tier: Margin: expected a decimal with at most 4 places',
    );
    expect(detail).not.toContain('statusCode');
  });

  it('reads a wrapped bare `Required` as a sentence, and keeps the whole path', async () => {
    const detail = await readableApiError(
      'Could not read the history',
      badRequest({
        message: [
          { code: 'invalid_type', path: ['from'], message: 'Required' },
          { code: 'custom', path: ['range', 'to'], message: 'must follow from' },
        ],
        error: 'Bad Request',
        statusCode: 400,
      }),
    );

    expect(detail).toBe(
      'Could not read the history: From is required; Range, to: must follow from',
    );
  });

  it('still takes the gloss path when `message` is a STRING, not an array', async () => {
    const detail = await readableApiError(
      'Quote could not be created',
      conflict({ message: 'customer-on-credit-hold' }),
    );

    expect(detail).toContain('Billing Manager');
  });

  it('keeps the whole path on an issues array, which a flatten cannot', async () => {
    const detail = await readableApiError(
      'Save failed',
      badRequest([{ path: ['lines', 0, 'quantityRolls'], message: 'expected a number' }]),
    );

    expect(detail).toContain('Lines, row 1, Rolls: expected a number');
  });

  it('renders a path-less issue as the sentence it is', async () => {
    const detail = await readableApiError(
      'Save failed',
      badRequest([{ path: [], message: 'the request makes no sense' }]),
    );

    expect(detail).toBe('Save failed: the request makes no sense');
  });

  it('still prefers a stable reason over field errors in the same body', async () => {
    const detail = await readableApiError(
      'Quote could not be created',
      new Response(
        JSON.stringify({
          reason: 'customer-on-credit-hold',
          formErrors: [],
          fieldErrors: { customerId: ['on hold'] },
        }),
        { status: 409 },
      ),
    );

    expect(detail).toContain('Billing Manager');
    expect(detail).not.toContain('customerId');
  });

  it('truncates a long rendering exactly as it always did', async () => {
    const detail = await readableApiError(
      'Save failed',
      badRequest({
        formErrors: [],
        fieldErrors: Object.fromEntries(
          Array.from({ length: 20 }, (_, i) => [`field${String(i)}`, ['is wrong in some way']]),
        ),
      }),
    );

    expect(detail.endsWith('…')).toBe(true);
    expect(detail).toContain('Field0: is wrong in some way');
  });

  it('leaves a body that is neither shape exactly as it was', async () => {
    const detail = await readableApiError('Save failed', badRequest({ statusCode: 400 }));

    expect(detail).toBe('Save failed: {"statusCode":400}');
  });
});

function notFound(): Response {
  return new Response(JSON.stringify({ message: 'Not Found', statusCode: 404 }), { status: 404 });
}

describe('readableApiError on a bare 404 or 403', () => {
  it('leaves a typed refusal alone even on a 404 or 403', async () => {
    const detail = await readableApiError(
      'Could not send that',
      new Response(JSON.stringify({ reason: 'no-order-confirmation-recipient', statusCode: 404 }), {
        status: 404,
      }),
    );

    expect(detail).toContain('nobody on that account is tagged to receive order confirmations');
    expect(detail).not.toContain('no longer there');
  });

  it('never puts the HTTP status in the sentence', async () => {
    const banners = await Promise.all([
      readableApiError('Could not save that', conflict({ reason: 'stale-aggregate' })),
      readableApiError(
        'Could not save that',
        badRequest({ formErrors: [], fieldErrors: { quantityRolls: ['must be at least 1'] } }),
      ),
      readableApiError('Save failed', new Response('nope', { status: 502 })),
      readableApiError('Could not save that', notFound()),
    ]);

    for (const banner of banners) {
      expect(banner, banner).not.toMatch(/\(\d{3}\)/);
    }
  });

  it('says what a missing record means instead of printing "Not Found"', async () => {
    const detail = await readableApiError('Could not save that', notFound());

    expect(detail).toContain('no longer there');

    expect(detail).toContain('Reload and check');
    expect(detail).not.toContain('Not Found');
  });

  it('glosses the roles guard’s 403, which says only "Forbidden"', async () => {
    const detail = await readableApiError(
      'Could not lift the hold',
      new Response(JSON.stringify({ message: 'Forbidden', statusCode: 403 }), { status: 403 }),
    );

    expect(detail).toContain('does not have the role this action needs');

    expect(detail).toContain('Ask an Admin');
    expect(detail).not.toContain('Forbidden');
  });

  it('glosses the "Forbidden resource" phrasing too', async () => {
    const detail = await readableApiError(
      'Could not lift the hold',
      new Response(
        JSON.stringify({ message: 'Forbidden resource', error: 'Forbidden', statusCode: 403 }),
        { status: 403 },
      ),
    );

    expect(detail).toContain('does not have the role this action needs');
    expect(detail).not.toContain('Forbidden resource');
  });

  it('leaves a route’s own human message alone', async () => {
    const detail = await readableApiError(
      'Could not open that',
      new Response(JSON.stringify({ message: 'that document is not on this order' }), {
        status: 404,
      }),
    );

    expect(detail).toBe('Could not open that: that document is not on this order');
  });

  it('does not gloss the same phrase under a status it does not belong to', async () => {
    const detail = await readableApiError(
      'Save failed',
      new Response(JSON.stringify({ message: 'Not Found', statusCode: 500 }), { status: 500 }),
    );

    expect(detail).toBe('Save failed: Not Found');
  });

  it('glosses an empty-bodied 403 instead of printing a bare number', async () => {
    const detail = await readableApiError('Save failed', new Response('', { status: 403 }));

    expect(detail).toContain('does not have the role this action needs');
    expect(detail).not.toContain('403');
  });

  it('glosses the JSON parser’s 413, which says only "request entity too large"', async () => {
    const detail = await readableApiError(
      'Could not read those rates',
      new Response(JSON.stringify({ statusCode: 413, message: 'request entity too large' }), {
        status: 413,
      }),
    );

    expect(detail).toBe(
      'Could not read those rates: that was more than the server takes in one go, so nothing was saved. Send less at a time, and if it happens again tell IT which screen you were on.',
    );
    expect(detail).not.toContain('request entity too large');
  });

  it('glosses an empty-bodied 413 the same way', async () => {
    const detail = await readableApiError('Save failed', new Response('', { status: 413 }));

    expect(detail).toContain('more than the server takes in one go');
    expect(detail).not.toContain('413');
  });
});

describe('what a banner reads like', () => {
  it('turns Nest’s "Internal server error" into something a reader can do', async () => {
    const detail = await readableApiError(
      'Save failed',
      new Response(JSON.stringify({ message: 'Internal server error', statusCode: 500 }), {
        status: 500,
      }),
    );

    expect(detail).toContain('something went wrong on the server');
    expect(detail).toContain('nothing was saved');
    expect(detail).toContain('which screen you were on');
    expect(detail).not.toContain('Internal server error');
  });

  it('keeps a 500 that explains itself, and mints no reference for one that does not', async () => {
    const detail = await readableApiError(
      'Save failed',
      new Response(JSON.stringify({ message: 'the tax rate lookup timed out', statusCode: 500 }), {
        status: 500,
      }),
    );

    expect(detail).toBe('Save failed: the tax rate lookup timed out');
    expect(detail).not.toMatch(/reference/i);
  });
});

describe('the resend refusals', () => {
  it('names a permanent relay refusal as permanent, rather than inviting a retry', async () => {
    const detail = await readableApiError(
      'Could not re-send that quote',
      conflict({ reason: 'relay-refused', attempts: 1, message: 'the mail relay refused' }, 503),
    );
    expect(detail).toContain('refused');
    expect(detail).toContain('again will be refused');
    expect(detail).not.toContain('relay-refused');
  });

  it('tells the reader a transient relay failure lost nothing and is worth retrying', async () => {
    const detail = await readableApiError(
      'Could not re-send that quote',
      conflict({ reason: 'relay-unreachable', attempts: 3, message: 'could not be reached' }, 503),
    );
    expect(detail).toContain('nothing was sent');
    expect(detail).toContain('Try again');
    expect(detail).not.toContain('relay-unreachable');
  });
});

describe('a first send whose move could not be undone', () => {
  for (const reason of ['relay-refused', 'relay-unreachable']) {
    it(`says the email did not go out and the quote shows as sent, for ${reason}`, async () => {
      const detail = await readableApiError(
        'Could not email the quote',
        conflict({ reason, value: 'left-quoted', attempts: 1, message: 'relay' }, 503),
      );

      expect(detail).toContain('did not go out');
      expect(detail).toContain('shows as sent');
      expect(detail).not.toContain('nothing was lost');
      expect(detail.length).toBeLessThanOrEqual('Could not email the quote: '.length + 200);
    });
  }
});

describe('document storage failures', () => {
  const NOT_WRITABLE =
    'Could not email the quote: the ERP could not file the document: its document storage is not writable. It is not your figures. Trying again will fail the same way until IT fixes it; tell IT: document storage, and which screen.';

  function storage503(value: unknown): Response {
    return conflict(
      {
        reason: 'document-storage-unavailable',
        value,
        message:
          'the ERP could not write this document to its document storage. Tell IT: document storage.',
      },
      503,
    );
  }

  it('reads not-writable, full and not-a-directory as one sentence that names IT', async () => {
    for (const value of ['not-writable', 'full', 'not-a-directory']) {
      expect(await readableApiError('Could not email the quote', storage503(value)), value).toBe(
        NOT_WRITABLE,
      );
    }

    expect(NOT_WRITABLE).not.toContain('Try again');

    expect(NOT_WRITABLE).not.toContain('Nothing was saved');
  });

  it('reads missing as a misplaced copy, not a failed write', async () => {
    expect(await readableApiError('Could not send that quote', storage503('missing'))).toBe(
      'Could not send that quote: the stored copy of this document is not where the ERP filed it. Nothing is lost on the record; tell IT: document storage, and which document.',
    );
  });

  it('falls back to the reason’s own sentence for unknown, or a value nobody named', async () => {
    const fallback = REASON_GLOSS['document-storage-unavailable'];
    expect(fallback).toBeDefined();
    for (const value of ['unknown', 'a-code-from-next-year', undefined, 7]) {
      expect(await readableApiError('Could not send that quote', storage503(value))).toBe(
        `Could not send that quote: ${fallback}`,
      );
    }
  });

  it('glosses every code the store can report, within the 200-character truncation', () => {
    for (const code of DOCUMENT_STORAGE_FAILURES) {
      const gloss =
        REASON_VALUE_GLOSS['document-storage-unavailable']?.[code] ??
        REASON_GLOSS['document-storage-unavailable'];
      expect(gloss, code).toBeDefined();
      expect(gloss?.length, code).toBeLessThanOrEqual(200);
    }
  });
});

describe('a tax jurisdiction no rate is loaded for', () => {
  const REMEDY =
    'Use ID, or WA- and the four-digit DOR location code, such as WA-0202 for Clarkston. ' +
    'Settings > Tax rates lists the codes loaded.';

  function unknown422(value: unknown): Response {
    return conflict(
      {
        reason: 'unknown-tax-jurisdiction',
        value,
        message: 'line 2: no tax rate is loaded for tax jurisdiction "WA-2717"',
      },
      422,
    );
  }

  it('names the line and the key from the quote line save', async () => {
    expect(
      await readableApiError(
        'Save failed',
        unknown422({ lineNumber: 2, taxJurisdiction: 'WA-2717' }),
      ),
    ).toBe(
      `Save failed: no tax rate is loaded for WA-2717 on line 2, so nothing was saved. ${REMEDY}`,
    );
  });

  it('names the key alone for an order’s added line, which is one line', async () => {
    expect(
      await readableApiError('Could not add the line', unknown422({ taxJurisdiction: 'WA-2717' })),
    ).toBe(
      `Could not add the line: no tax rate is loaded for WA-2717, so nothing was saved. ${REMEDY}`,
    );
  });

  it('falls back to the reason’s own sentence without the figures', async () => {
    expect(await readableApiError('Save failed', unknown422(undefined))).toBe(
      `Save failed: ${REASON_GLOSS['unknown-tax-jurisdiction'] ?? ''}`,
    );
    expect(REASON_GLOSS['unknown-tax-jurisdiction']).toBe(
      `no tax rate is loaded for that tax jurisdiction, so nothing was saved. ${REMEDY}`,
    );
  });

  it('stays inside the 200-character truncation, whatever the line number', () => {
    const gloss = REASON_FIGURES_GLOSS['unknown-tax-jurisdiction']?.({
      lineNumber: 200,
      taxJurisdiction: 'WA-2717',
    });
    expect(gloss?.length).toBeLessThanOrEqual(200);
    expect(REASON_GLOSS['unknown-tax-jurisdiction']?.length).toBeLessThanOrEqual(200);
  });
});
