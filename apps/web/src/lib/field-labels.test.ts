// Tests the field labels used in validation messages.
import { describe, expect, it } from 'vitest';

import { fieldLabel } from './field-labels';

describe('fieldLabel', () => {
  it('uses the label the form shows', () => {
    expect(fieldLabel('paperCostPerTonne')).toBe('Paper cost per tonne');
    expect(fieldLabel('basisWeightLb')).toBe('Basis weight (lb)');
    expect(fieldLabel('confirmedLeadTimeDays')).toBe('Lead time (days)');
    expect(fieldLabel('freightMarginPct')).toBe('Freight margin');
    expect(fieldLabel('poNumber')).toBe('PO number');
  });

  it('never returns a code name for a field it does not know', () => {
    expect(fieldLabel('customerPartNumber')).toBe('Customer part number');
    expect(fieldLabel('orderLineId')).toBe('Order line id');
    expect(fieldLabel('legacyUmbrellaAccountNumber')).toBe('Legacy umbrella account number');
  });

  it('leaves an already-plain name alone but opens it as a sentence', () => {
    expect(fieldLabel('from')).toBe('From');
    expect(fieldLabel('reason')).toBe('Reason');
  });

  it('keeps the context of a nested path, counting rows from one', () => {
    expect(fieldLabel('lines.0.quantityRolls')).toBe('Lines, row 1, Rolls');
    expect(fieldLabel('lines.7.quantityRolls')).toBe('Lines, row 8, Rolls');
    expect(fieldLabel('range.to')).toBe('Range, to');
  });

  it('prefers an exact path over its last segment', () => {
    expect(fieldLabel('destination.city')).toBe('Destination, city');
  });

  it('handles a run of capitals without splitting it into letters', () => {
    expect(fieldLabel('customerPONumber')).toBe('Customer po number');
  });
});
