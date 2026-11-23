// Tests the `confirmRecipients` body a send form posts, including the empty list and the absent one.
import { describe, expect, it } from 'vitest';

import {
  CONFIRM_RECIPIENTS_FIELD,
  CONFIRM_RECIPIENTS_SHOWN_FIELD,
  confirmRecipientsBody,
  recipientListLabel,
} from './confirm-recipients';

function form(entries: readonly (readonly [string, string])[]): FormData {
  const data = new FormData();
  for (const [key, value] of entries) data.append(key, value);
  return data;
}

describe('confirmRecipientsBody', () => {
  it('posts an EMPTY list when the form showed a list and it was empty', () => {
    expect(confirmRecipientsBody(form([[CONFIRM_RECIPIENTS_SHOWN_FIELD, '1']]))).toEqual({
      confirmRecipients: [],
    });
  });

  it('posts every address the form showed', () => {
    expect(
      confirmRecipientsBody(
        form([
          [CONFIRM_RECIPIENTS_SHOWN_FIELD, '1'],
          [CONFIRM_RECIPIENTS_FIELD, 'fixture-01@example.test'],
          [CONFIRM_RECIPIENTS_FIELD, 'fixture-15@example.test'],
        ]),
      ),
    ).toEqual({ confirmRecipients: ['fixture-01@example.test', 'fixture-15@example.test'] });
  });

  it('posts NOTHING when the form rendered no recipient list at all', () => {
    expect(confirmRecipientsBody(form([['quoteId', 'x']]))).toEqual({});
  });
});

describe('recipientListLabel', () => {
  it('names every address, never a count', () => {
    expect(recipientListLabel(['fixture-02@example.test', 'fixture-16@example.test'])).toBe(
      'fixture-02@example.test, fixture-16@example.test',
    );
  });
});
