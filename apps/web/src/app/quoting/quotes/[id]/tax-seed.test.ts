// Tests the tax treatment a new line starts on.
import { DEFAULT_PAYMENT_TERMS, type Customer } from '@erp/types';
import { describe, expect, it } from 'vitest';

import { seedTaxTreatment, taxableStatusFor } from './tax-seed';

const ACCOUNT: Customer = {
  id: '2c9a5f18-7b3e-4d02-9a61-8e5c4b7d3f10',
  name: 'Sample Wholesale',
  paymentTerms: DEFAULT_PAYMENT_TERMS,
  taxExempt: false,
  reseller: false,

  lockVersion: 1,
  creditHold: false,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
};

describe('seedTaxTreatment', () => {
  it('seeds an exempt account as non-taxable, naming no jurisdiction', () => {
    expect(seedTaxTreatment({ ...ACCOUNT, taxExempt: true })).toEqual({
      taxStatus: 'non_tax',
      taxJurisdiction: '',
    });
  });

  it('treats a reseller the same way', () => {
    expect(seedTaxTreatment({ ...ACCOUNT, reseller: true })).toEqual({
      taxStatus: 'non_tax',
      taxJurisdiction: '',
    });
  });

  it('drops an exempt account’s jurisdiction rather than contradicting itself', () => {
    expect(seedTaxTreatment({ ...ACCOUNT, taxExempt: true, taxJurisdiction: 'ID' })).toEqual({
      taxStatus: 'non_tax',
      taxJurisdiction: '',
    });
  });

  it('seeds the state the stored code already names', () => {
    expect(seedTaxTreatment({ ...ACCOUNT, taxJurisdiction: 'ID' })).toEqual({
      taxStatus: 'id_tax',
      taxJurisdiction: 'ID',
    });
    expect(seedTaxTreatment({ ...ACCOUNT, taxJurisdiction: 'WA-0202' })).toEqual({
      taxStatus: 'wa_tax',
      taxJurisdiction: 'WA-0202',
    });
  });

  it('seeds the state but not a stored code that is not a key', () => {
    for (const stored of ['WA', 'WA-SPO', 'wa-0202']) {
      expect(seedTaxTreatment({ ...ACCOUNT, taxJurisdiction: stored }), stored).toEqual({
        taxStatus: 'wa_tax',
        taxJurisdiction: '',
      });
    }
  });

  it('books an out-of-state delivery as non-taxable', () => {
    expect(seedTaxTreatment({ ...ACCOUNT, taxJurisdiction: 'OR' })).toEqual({
      taxStatus: 'non_tax',
      taxJurisdiction: '',
    });
  });

  it('clears the jurisdiction when it books non-taxable, or the save is refused', () => {
    for (const jurisdiction of ['OR', 'MT', 'CA-LAX', 'NV']) {
      expect(seedTaxTreatment({ ...ACCOUNT, taxJurisdiction: jurisdiction }), jurisdiction).toEqual(
        { taxStatus: 'non_tax', taxJurisdiction: '' },
      );
    }
  });

  it('still distinguishes WHY a line is non-taxable, without a fourth status', () => {
    const exempt = seedTaxTreatment({ ...ACCOUNT, taxExempt: true, taxJurisdiction: 'ID' });
    const outOfState = seedTaxTreatment({ ...ACCOUNT, taxJurisdiction: 'OR' });

    expect(exempt.taxStatus).toBe('non_tax');
    expect(outOfState.taxStatus).toBe('non_tax');

    expect(ACCOUNT.taxExempt).toBe(false);
  });

  it('does not read a state out of the middle of a word', () => {
    expect(seedTaxTreatment({ ...ACCOUNT, taxJurisdiction: 'MADISON' })).toEqual({
      taxStatus: 'non_tax',
      taxJurisdiction: '',
    });
  });

  it('never guesses a state when none is on file', () => {
    expect(seedTaxTreatment(ACCOUNT)).toEqual({ taxStatus: '', taxJurisdiction: '' });
  });

  it('asks rather than assumes when the customer could not be read', () => {
    expect(seedTaxTreatment(null)).toEqual({ taxStatus: '', taxJurisdiction: '' });
  });
});

describe('taxableStatusFor', () => {
  it('matches the leading token, not a substring', () => {
    expect(taxableStatusFor('MADISON')).toBeUndefined();
    expect(taxableStatusFor('FLORIDA')).toBeUndefined();
  });

  it('reads a code however it was typed', () => {
    expect(taxableStatusFor('  id  ')).toBe('id_tax');
    expect(taxableStatusFor('wa-spo')).toBe('wa_tax');
  });
});
