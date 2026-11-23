// Tests the tab title pattern.
import { describe, expect, it } from 'vitest';

import { APP_NAME, TITLE_TEMPLATE, fullTitle } from './titles';

describe('page titles', () => {
  it('puts the app name last, after a bar', () => {
    expect(TITLE_TEMPLATE).toBe('%s | Print Operations ERP');
    expect(fullTitle('Quote Q-00052')).toBe('Quote Q-00052 | Print Operations ERP');
  });

  it('keeps a title with a dollar sign intact', () => {
    expect(fullTitle("$& and $'")).toBe(`$& and $' | ${APP_NAME}`);
  });
});
