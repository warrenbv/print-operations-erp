// Tests the wording of the mail diversion notice.
import { describe, expect, it } from 'vitest';

import { mailModeSentence } from './mail-mode';

describe('mailModeSentence', () => {
  it('says nothing in normal running', () => {
    expect(mailModeSentence(null)).toBeUndefined();
  });

  it('names the catch-all and who still gets real email', () => {
    expect(
      mailModeSentence({
        to: 'fixture-24@example.test',
        allow: ['fixture-38@example.test', 'fixture-36@example.test'],
      }),
    ).toBe(
      'Test mode: customer email goes to fixture-24@example.test. ' +
        'Real email reaches only fixture-38@example.test, fixture-36@example.test.',
    );
  });

  it('says every email is diverted when nobody is on the allow list', () => {
    expect(mailModeSentence({ to: 'fixture-24@example.test', allow: [] })).toBe(
      'Test mode: every email goes to fixture-24@example.test.',
    );
  });
});
