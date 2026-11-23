// Tests for grade widths and the pallet wording.
import { describe, expect, it } from 'vitest';

import { gradeWidthSchema, palletsText, rollsPerPalletText } from '../src';

describe('gradeWidthSchema', () => {
  it('takes a count from 1 to 10000', () => {
    for (const rollsPerPallet of [1, 50, 10_000]) {
      expect(gradeWidthSchema.parse({ rollWidthIn: 9, rollsPerPallet })).toEqual({
        rollWidthIn: 9,
        rollsPerPallet,
      });
    }
  });

  it('reads a width with no count, absent or null, as not counted', () => {
    expect(gradeWidthSchema.parse({ rollWidthIn: 9 })).toEqual({
      rollWidthIn: 9,
      rollsPerPallet: null,
    });
    expect(gradeWidthSchema.parse({ rollWidthIn: 9, rollsPerPallet: null })).toEqual({
      rollWidthIn: 9,
      rollsPerPallet: null,
    });
  });

  it('refuses a count of zero, a negative, a fraction or one past the bound', () => {
    for (const rollsPerPallet of [0, -5, 7.5, 10_001]) {
      expect(gradeWidthSchema.safeParse({ rollWidthIn: 9, rollsPerPallet }).success).toBe(false);
    }
  });
});

describe('palletsText and rollsPerPalletText', () => {
  it('say not counted in words for a line or a width with no count', () => {
    expect(palletsText(null)).toBe('pallets not counted');
    expect(palletsText(1)).toBe('1 pallet');
    expect(palletsText(4)).toBe('4 pallets');
    expect(rollsPerPalletText(null)).toBe('rolls per pallet not counted');
    expect(rollsPerPalletText(50)).toBe('50 / pallet');
  });
});
