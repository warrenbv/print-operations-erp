// Tests the return path and the sent notice.
import { describe, expect, it } from 'vitest';

import { returnPath, sentNotice } from './sent-notice';

describe('returnPath', () => {
  it('honours only the literal review, never a path', () => {
    expect(returnPath('q-1', 'review')).toBe('/quoting/quotes/q-1/review');
    expect(returnPath('q-1', null)).toBe('/quoting/quotes/q-1');
    expect(returnPath('q-1', '/orders')).toBe('/quoting/quotes/q-1');
    expect(returnPath('q-1', 'https://elsewhere.test')).toBe('/quoting/quotes/q-1');
  });
});

describe('sentNotice', () => {
  it('names every recipient and the time the relay took it', () => {
    expect(
      sentNotice(
        ['fixture-03@example.test', 'fixture-17@example.test'],
        '2026-10-08T16:12:00.000Z',
      ),
    ).toBe(
      'Quote sent to fixture-03@example.test, fixture-17@example.test at 2026-10-08 09:12 PDT.',
    );
  });

  it('stops at the addresses when no time came back', () => {
    expect(sentNotice(['fixture-03@example.test'], undefined)).toBe(
      'Quote sent to fixture-03@example.test.',
    );
  });
});
