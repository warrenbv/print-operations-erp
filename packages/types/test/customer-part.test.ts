// Tests for the customer part number and description limits.
import { describe, expect, it } from 'vitest';

import {
  CUSTOMER_DESCRIPTION_MAX,
  CUSTOMER_PART_NUMBER_MAX,
  customerDescriptionSchema,
  customerPartNumberSchema,
  withCustomerDescription,
} from '../src/customer-part';
import { quoteLineInputSchema } from '../src/quote-calculation';

describe('the customer part number and description', () => {
  it('trims, and holds the bounds the CHECKs hold', () => {
    expect(customerPartNumberSchema.parse('  LN-1300-C ')).toBe('LN-1300-C');
    expect(customerPartNumberSchema.safeParse('X'.repeat(CUSTOMER_PART_NUMBER_MAX)).success).toBe(
      true,
    );
    expect(
      customerPartNumberSchema.safeParse('X'.repeat(CUSTOMER_PART_NUMBER_MAX + 1)).success,
    ).toBe(false);
    expect(customerPartNumberSchema.safeParse('   ').success).toBe(false);

    expect(customerDescriptionSchema.parse(' CEDAR CORE SHEET ')).toBe('CEDAR CORE SHEET');
    expect(customerDescriptionSchema.safeParse('X'.repeat(CUSTOMER_DESCRIPTION_MAX)).success).toBe(
      true,
    );
    expect(
      customerDescriptionSchema.safeParse('X'.repeat(CUSTOMER_DESCRIPTION_MAX + 1)).success,
    ).toBe(false);
    expect(CUSTOMER_PART_NUMBER_MAX).toBe(40);
    expect(CUSTOMER_DESCRIPTION_MAX).toBe(120);
  });

  it('rides on the saved quote line, each optional on its own', () => {
    const base = {
      gradeId: 'g',
      footageVariant: 'long',
      rollWidthIn: 11,
      quantityRolls: 4,
      overwrap: false,
      freight: { mode: 'pickup' },
      taxTreatment: { taxStatus: 'non_tax' },
    };
    const neither = quoteLineInputSchema.parse(base);
    expect(neither).not.toHaveProperty('customerPartNumber');
    expect(neither).not.toHaveProperty('customerDescription');

    expect(quoteLineInputSchema.parse({ ...base, customerPartNumber: 'LN-870' })).toMatchObject({
      customerPartNumber: 'LN-870',
    });
    expect(
      quoteLineInputSchema.parse({ ...base, customerDescription: 'CEDAR CORE SHEET' }),
    ).toMatchObject({ customerDescription: 'CEDAR CORE SHEET' });
  });

  it('leads a description with the customer description, and leaves it alone without one', () => {
    expect(withCustomerDescription('11" x wc', {})).toBe('11" x wc');
    expect(withCustomerDescription('11" x wc', { customerDescription: 'CEDAR CORE SHEET' })).toBe(
      'CEDAR CORE SHEET · 11" x wc',
    );
  });
});
