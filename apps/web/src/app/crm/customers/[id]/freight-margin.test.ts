// Tests showing the freight margin as a percent.
import { describe, expect, it } from 'vitest';

import { freightMarginPercent } from './freight-margin';

describe('freightMarginPercent', () => {
  it('prints the stored ratio as the percent the form asks for', () => {
    expect(freightMarginPercent('0.120000')).toBe('12');
  });

  it('does not round', () => {
    expect(freightMarginPercent('0.163250')).toBe('16.325');
  });

  it('prints a stored zero as 0, which is not the same as no margin at all', () => {
    expect(freightMarginPercent('0.000000')).toBe('0');
  });

  it('answers null when the account has no freight margin', () => {
    expect(freightMarginPercent(undefined)).toBeNull();
  });
});
