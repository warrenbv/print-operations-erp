// Tests for grade labels and product family names.
import { describe, expect, it } from 'vitest';

import { PRODUCT_FAMILIES, PRODUCT_FAMILY_LABELS, gradeLabel } from '../src/grade';

describe('gradeLabel', () => {
  it('names the family and then the code', () => {
    expect(gradeLabel({ productFamily: 'kraft', code: '40#' })).toBe('Kraft — 40#');
  });

  it('tells apart two families that share a code', () => {
    expect(gradeLabel({ productFamily: 'butcher', code: '40#' })).toBe('Butcher — 40#');
    expect(gradeLabel({ productFamily: 'digital_bond', code: '20#' })).toBe('Digital Bond — 20#');
  });
});

describe('PRODUCT_FAMILY_LABELS', () => {
  it('has words for every family, never the enum value', () => {
    for (const family of PRODUCT_FAMILIES) {
      expect(PRODUCT_FAMILY_LABELS[family]).not.toContain('_');
      expect(PRODUCT_FAMILY_LABELS[family].length).toBeGreaterThan(0);
    }
  });
});
