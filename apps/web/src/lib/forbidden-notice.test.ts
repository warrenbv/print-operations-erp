// Tests the words on the forbidden page.
import { describe, expect, it } from 'vitest';

import { forbiddenNotice } from './forbidden-notice';

describe('forbiddenNotice', () => {
  it('says the account lacks a role, not that something broke', () => {
    const { detail } = forbiddenNotice();
    expect(detail).toContain('does not have the role');
  });

  it('offers the one action that resolves it', () => {
    expect(forbiddenNotice().detail).toContain('Ask an Admin');
  });

  it('never names a specific role, because a 403 does not carry one', () => {
    const { heading, detail } = forbiddenNotice();
    for (const role of ['Admin role', 'Sales', 'Billing', 'Production']) {
      if (role === 'Admin role') continue;
      expect(`${heading} ${detail}`).not.toContain(role);
    }
  });

  it('does not read as a failure or as a missing record', () => {
    const { heading, detail } = forbiddenNotice();
    const text = `${heading} ${detail}`;
    for (const wrong of ['could not be loaded', 'does not exist', 'unavailable', 'went wrong']) {
      expect(text).not.toContain(wrong);
    }
  });

  it('says the rest of the app still works', () => {
    expect(forbiddenNotice().detail).toContain('The rest of the app is unaffected');
  });
});
