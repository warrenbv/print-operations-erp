// Tests the revenue category labels.
import { describe, expect, it } from 'vitest';

import { REVENUE_CATEGORY_LABELS } from './line-labels';

describe('the revenue category labels', () => {
  it('names print work by what the shop does, print and converting', () => {
    expect(REVENUE_CATEGORY_LABELS.print).toBe('Print & converting');
  });
});
