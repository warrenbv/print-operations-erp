// Tests the not-found words and that they differ from the error boundary's.
import { describe, expect, it } from 'vitest';

import { notFoundNotice } from './not-found-notice';
import { pageErrorNotice } from './page-error';

describe('notFoundNotice', () => {
  it('says the record is missing, not the page', () => {
    const { heading, detail } = notFoundNotice();
    expect(heading).toBe('Not found');
    expect(detail).toContain('record');
    expect(detail).not.toContain('page does not exist');
  });

  it('offers the two things a reader can actually do', () => {
    const { detail } = notFoundNotice();
    expect(detail).toContain('Check the link');
    expect(detail).toContain('search for it');
  });

  it('says the rest of the app still works', () => {
    expect(notFoundNotice().detail).toContain('rest of the app is unaffected');
  });

  it('never blames the reader or claims a failure', () => {
    const { heading, detail } = notFoundNotice();
    const text = `${heading} ${detail}`.toLowerCase();
    for (const word of ['error', 'failed', 'failure', 'invalid', 'wrong']) {
      expect(text).not.toContain(word);
    }
  });

  it('takes no arguments and is stable', () => {
    expect(notFoundNotice()).toEqual(notFoundNotice());
  });
});

describe('a missing record and a failed read do not read the same', () => {
  it('differs from the error boundary in both heading and detail', () => {
    const missing = notFoundNotice();
    const failed = pageErrorNotice(undefined);
    expect(missing.heading).not.toBe(failed.heading);
    expect(missing.detail).not.toBe(failed.detail);
  });

  it('leaves "could not be loaded" to the error boundary', () => {
    expect(pageErrorNotice(undefined).heading).toContain('could not be loaded');
    expect(notFoundNotice().heading).not.toContain('could not be loaded');
  });
});
