// Tests counting the lines priced per pound.
import { describe, expect, it } from 'vitest';

import { type OrderLine } from '@erp/types';

import { perPoundCount } from './derive';

describe('perPoundCount', () => {
  const at = (pricingBasis: string) => ({ pricingBasis }) as unknown as OrderLine;

  it('counts the lines whose basis is per pound', () => {
    expect(perPoundCount([at('per_pound'), at('per_roll')])).toBe(1);
    expect(perPoundCount([at('per_pound'), at('per_pound')])).toBe(2);
    expect(perPoundCount([at('per_roll')])).toBe(0);
    expect(perPoundCount([])).toBe(0);
  });
});
