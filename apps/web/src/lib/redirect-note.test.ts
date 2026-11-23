// Tests the test-mode suffix on a sent-message notice.
import { describe, expect, it } from 'vitest';

import { redirectNote } from './redirect-note';

describe('redirectNote', () => {
  it('adds nothing when the send went where it was addressed', () => {
    expect(redirectNote(undefined)).toBe('');
    expect(redirectNote([])).toBe('');
  });

  it('names where a redirected send really went', () => {
    expect(`fixture-19@example.test${redirectNote(['fixture-24@example.test'])}`).toBe(
      'fixture-19@example.test (test mode: went to fixture-24@example.test)',
    );
  });

  it('lists every address the relay was handed', () => {
    expect(redirectNote(['fixture-38@example.test', 'fixture-24@example.test'])).toBe(
      ' (test mode: went to fixture-38@example.test, fixture-24@example.test)',
    );
  });
});
