// Tests that every request taking a tax jurisdiction takes the key format, and that stored values still read.
import { describe, expect, it } from 'vitest';

import {
  createCustomerRequestSchema,
  customerSchema,
  updateCustomerRequestSchema,
} from '../src/customer';
import { orderLineSchema } from '../src/order';
import { quoteLineSchema } from '../src/quote';
import { quoteLineInputSchema } from '../src/quote-calculation';
import {
  TAX_JURISDICTION_KEY_RULE,
  lineTaxTreatmentSchema,
  taxJurisdictionKeySchema,
} from '../src/revenue';

describe('the tax jurisdiction key', () => {
  it('takes Idaho and a Washington DOR location code, trimmed', () => {
    expect(taxJurisdictionKeySchema.parse('ID')).toBe('ID');
    expect(taxJurisdictionKeySchema.parse('WA-0202')).toBe('WA-0202');
    expect(taxJurisdictionKeySchema.parse('  WA-0202 ')).toBe('WA-0202');
  });

  it('refuses a bare state with the sentence that gives the format', () => {
    const refused = taxJurisdictionKeySchema.safeParse('WA');

    expect(refused.success).toBe(false);
    expect(refused.error?.issues[0]?.message).toBe(TAX_JURISDICTION_KEY_RULE);
    expect(TAX_JURISDICTION_KEY_RULE).toBe(
      'tax jurisdiction must be ID, or WA- and the four-digit DOR location code, ' +
        'such as WA-0202 for Clarkston.',
    );
  });

  it.each([
    ['WA-02020'],

    ['WA-202'],

    ['  wa-0202 '],
    ['id'],

    ['WA-ASOTIN'],
    ['WA-SAMPLE'],

    ['WA 0202'],
    ['OR'],
    [''],
  ])('refuses %j', (typed) => {
    expect(taxJurisdictionKeySchema.safeParse(typed).success).toBe(false);
  });
});

describe('every request that takes a tax jurisdiction takes the key', () => {
  const LINE = {
    gradeId: 'g',
    footageVariant: 'long',
    rollWidthIn: 11,
    quantityRolls: 4,
    overwrap: false,
    freight: { mode: 'pickup' },
  };
  const washington = (taxJurisdiction: string) => ({ taxStatus: 'wa_tax', taxJurisdiction });

  it('on the customer create and update requests', () => {
    expect(
      createCustomerRequestSchema.safeParse({ name: 'Acme', taxJurisdiction: 'WA' }).success,
    ).toBe(false);
    expect(
      createCustomerRequestSchema.safeParse({ name: 'Acme', taxJurisdiction: 'WA-0202' }).success,
    ).toBe(true);
    expect(
      updateCustomerRequestSchema.safeParse({ taxJurisdiction: 'WA', lockVersion: 1 }).success,
    ).toBe(false);
    expect(
      updateCustomerRequestSchema.safeParse({ taxJurisdiction: 'ID', lockVersion: 1 }).success,
    ).toBe(true);

    expect(
      updateCustomerRequestSchema.safeParse({ taxJurisdiction: null, lockVersion: 1 }).success,
    ).toBe(true);
  });

  it('on the quote line', () => {
    expect(
      quoteLineInputSchema.safeParse({ ...LINE, taxTreatment: washington('WA') }).success,
    ).toBe(false);
    expect(
      quoteLineInputSchema.safeParse({ ...LINE, taxTreatment: washington('WA-0202') }).success,
    ).toBe(true);
    expect(lineTaxTreatmentSchema.safeParse(washington('WA-SAMPLE')).success).toBe(false);
  });
});

describe('a stored jurisdiction that is a bare state code reads', () => {
  it.each([
    ['customerSchema', customerSchema.shape.taxJurisdiction],
    ['quoteLineSchema', quoteLineSchema.shape.taxJurisdiction],
    ['orderLineSchema', orderLineSchema.shape.taxJurisdiction],
  ])('%s reads a bare WA', (_name, field) => {
    expect(field.parse('WA')).toBe('WA');
  });
});
