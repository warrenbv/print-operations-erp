// Tests the error boundary's words and its reference.
import { describe, expect, it } from 'vitest';

import { pageErrorNotice } from './page-error';

describe('pageErrorNotice', () => {
  it('carries the digest as a quotable reference', () => {
    expect(pageErrorNotice('4173920586').reference).toBe('4173920586');
  });

  it('omits the reference when there is no digest', () => {
    expect(pageErrorNotice(undefined)).not.toHaveProperty('reference');
    expect(pageErrorNotice('')).not.toHaveProperty('reference');
  });

  it('says the failure is this page, not the application', () => {
    const { detail } = pageErrorNotice('abc');
    expect(detail).toContain('The rest of the app is unaffected');
  });

  it('does not guess at a cause', () => {
    const { heading, detail } = pageErrorNotice('abc');
    for (const wrong of ['API', 'network', 'server', 'database', 'timeout', '500']) {
      expect(`${heading} ${detail}`).not.toContain(wrong);
    }
  });

  it('never leaks the error text, because it is never given it', () => {
    expect(pageErrorNotice.length).toBe(1);
  });
});
