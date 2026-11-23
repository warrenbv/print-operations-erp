// Tests the wording and redirects when the PO document is or is not attached.
import { describe, expect, it } from 'vitest';

import {
  CHOOSE_THE_DOCUMENT_AGAIN,
  DOCUMENT_NOT_ATTACHED,
  PO_MISSING_FIELD,
  createdNotice,
  documentMissingSentence,
  documentRefusedUrl,
  ordersCreatedUrl,
  refusedPress,
} from './convert-po-document';
import { NO_LINE_REFUSAL } from './convert-request';

const ORDER_PATH = '/orders/0192f6c4-7a1b-7c3d-8e9f-0a1b2c3d4e5f';

function query(url: string): URLSearchParams {
  return new URLSearchParams(url.slice(url.indexOf('?') + 1));
}

describe('refusedPress', () => {
  it('asks for the PO document again when one had been chosen', () => {
    expect(CHOOSE_THE_DOCUMENT_AGAIN).toBe('Choose the PO document again.');
    expect(refusedPress(NO_LINE_REFUSAL, true)).toBe(
      'Put at least one line on the order. Choose the PO document again.',
    );
  });

  it('leaves the refusal as it is when no file was chosen', () => {
    expect(refusedPress(NO_LINE_REFUSAL, false)).toBe('Put at least one line on the order.');
  });
});

describe('documentRefusedUrl', () => {
  const refusal =
    'Attaching the document failed: only a PDF can be attached here. Save or export the file as a PDF, then attach it again.';

  it('lands on the order with the Documents fold open, the lead sentence first', () => {
    const url = documentRefusedUrl(ORDER_PATH, refusal, undefined);
    expect(url.startsWith(`${ORDER_PATH}?`)).toBe(true);
    const params = query(url);
    expect(DOCUMENT_NOT_ATTACHED).toBe(
      'The order was created, but the PO document was not attached.',
    );
    expect(params.get('error')).toBe(`${DOCUMENT_NOT_ATTACHED} ${refusal}`);
    expect(params.get('field')).toBe('documents');
    expect(params.has('notice')).toBe(false);
  });

  it('keeps the over-quantity notice beside the error', () => {
    const notice = 'Line 1 is 5 rolls over the quoted quantity.';
    const params = query(documentRefusedUrl(ORDER_PATH, refusal, notice));
    expect(params.get('error')).toBe(`${DOCUMENT_NOT_ATTACHED} ${refusal}`);
    expect(params.get('notice')).toBe(notice);
  });

  it('says the lead sentence alone when the attach gave no words', () => {
    const params = query(documentRefusedUrl(ORDER_PATH, undefined, undefined));
    expect(params.get('error')).toBe(DOCUMENT_NOT_ATTACHED);
    expect(params.get('field')).toBe('documents');
  });
});

const QUOTE_PATH = '/quoting/quotes/0192f6c4-7a1b-7c3d-8e9f-0a1b2c3d4e60';

describe('createdNotice', () => {
  it('names the PO and each delivery date', () => {
    expect(createdNotice('7716402', ['2027-06-10', '2027-07-15'], undefined)).toBe(
      '2 orders created for PO 7716402: delivery 2027-06-10 and delivery 2027-07-15.',
    );
    expect(createdNotice('7716402', ['2027-06-10', '2027-07-15', '2027-08-20'], undefined)).toBe(
      '3 orders created for PO 7716402: delivery 2027-06-10, delivery 2027-07-15 and delivery 2027-08-20.',
    );
  });

  it('leaves the PO out when none was typed, and adds the over-quantity notice', () => {
    expect(
      createdNotice(
        undefined,
        ['2027-06-10', '2027-07-15'],
        'Line 1 is 2 rolls over the quoted quantity.',
      ),
    ).toBe(
      '2 orders created: delivery 2027-06-10 and delivery 2027-07-15. Line 1 is 2 rolls over the quoted quantity.',
    );
  });
});

describe('ordersCreatedUrl', () => {
  const notice = '2 orders created: delivery 2027-06-10 and delivery 2027-07-15.';

  it('lands on the quote with the notice when every order has the file, or none was chosen', () => {
    for (const url of [
      ordersCreatedUrl(QUOTE_PATH, notice),
      ordersCreatedUrl(QUOTE_PATH, notice, { orderIds: [], made: 2, refusal: undefined }),
    ]) {
      expect(url.startsWith(`${QUOTE_PATH}?`)).toBe(true);
      const params = query(url);
      expect(params.get('notice')).toBe(notice);
      expect(params.has('error')).toBe(false);
      expect(params.has(PO_MISSING_FIELD)).toBe(false);
    }
  });

  it('names the orders without the file, with the refusal s words, and never Create orders', () => {
    const refusal = 'Attaching the document failed: only a PDF can be attached here.';
    const url = ordersCreatedUrl(QUOTE_PATH, notice, { orderIds: ['a', 'b'], made: 2, refusal });
    expect(url.startsWith(`${QUOTE_PATH}?`)).toBe(true);
    const params = query(url);
    expect(params.get('notice')).toBe(notice);
    expect(params.get('error')).toBe(
      `The PO document was not attached to 2 of the 2 orders. ${refusal}`,
    );
    expect(params.get(PO_MISSING_FIELD)).toBe('a,b');
  });

  it('says the lead sentence alone when an attach threw', () => {
    const params = query(
      ordersCreatedUrl(QUOTE_PATH, notice, { orderIds: ['b'], made: 3, refusal: undefined }),
    );
    expect(params.get('error')).toBe(documentMissingSentence(1, 3));
    expect(documentMissingSentence(1, 3)).toBe(
      'The PO document was not attached to 1 of the 3 orders.',
    );
  });
});
