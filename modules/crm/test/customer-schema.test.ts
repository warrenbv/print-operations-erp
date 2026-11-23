// The customer request and search schemas from packages/types/src/customer.ts.
import { describe, expect, it } from 'vitest';

import {
  setCreditHoldRequestSchema,
  DEFAULT_NET_DAYS,
  createCustomerRequestSchema,
  customerSearchQuerySchema,
  customerNameSchema,
  customerNameListResponseSchema,
  updateCustomerRequestSchema,
  CUSTOMER_NAME_LIST_MAX,
  CUSTOMER_SEARCH_DEFAULT_LIMIT,
  CUSTOMER_SEARCH_MAX_LIMIT,
} from '@erp/types';

describe('createCustomerRequestSchema', () => {
  it('trims the name', () => {
    const parsed = createCustomerRequestSchema.parse({ name: '  Acme  ' });
    expect(parsed.name).toBe('Acme');
  });

  it('rejects an empty name', () => {
    expect(() => createCustomerRequestSchema.parse({ name: '' })).toThrow();
    expect(() => createCustomerRequestSchema.parse({ name: '   ' })).toThrow();
  });

  it('rejects a name longer than 255 characters', () => {
    expect(() => createCustomerRequestSchema.parse({ name: 'x'.repeat(256) })).toThrow();
  });

  it('accepts optional legacy account numbers', () => {
    const parsed = createCustomerRequestSchema.parse({
      name: 'Acme',
      legacyAccountNumber: '48213',
      legacyUmbrellaAccountNumber: 'PARENT',
    });
    expect(parsed.legacyAccountNumber).toBe('48213');
    expect(parsed.legacyUmbrellaAccountNumber).toBe('PARENT');
  });

  it('trims legacy account numbers so a stray space cannot defeat uniqueness', () => {
    const parsed = createCustomerRequestSchema.parse({
      name: 'Acme',
      legacyAccountNumber: '  48213  ',
    });
    expect(parsed.legacyAccountNumber).toBe('48213');
  });
});

describe('updateCustomerRequestSchema', () => {
  it('accepts an empty patch', () => {
    expect(updateCustomerRequestSchema.parse({ lockVersion: 1 })).toEqual({ lockVersion: 1 });
  });

  it('preserves per-field validation instead of collapsing to bare string', () => {
    expect(() => updateCustomerRequestSchema.parse({ name: '', lockVersion: 1 })).toThrow();
    expect(() =>
      updateCustomerRequestSchema.parse({ name: 'x'.repeat(256), lockVersion: 1 }),
    ).toThrow();
  });

  it('trims values on update just like on create', () => {
    const parsed = updateCustomerRequestSchema.parse({ name: '  Acme  ', lockVersion: 1 });
    expect(parsed.name).toBe('Acme');
  });
});

describe('customerSearchQuerySchema', () => {
  it('defaults limit and offset when absent', () => {
    const parsed = customerSearchQuerySchema.parse({});
    expect(parsed.limit).toBe(CUSTOMER_SEARCH_DEFAULT_LIMIT);
    expect(parsed.offset).toBe(0);
  });

  it('coerces string query params from Express into numbers', () => {
    const parsed = customerSearchQuerySchema.parse({ limit: '10', offset: '20' });
    expect(parsed.limit).toBe(10);
    expect(parsed.offset).toBe(20);
  });

  it('caps limit at the max to keep responses bounded', () => {
    expect(() =>
      customerSearchQuerySchema.parse({ limit: String(CUSTOMER_SEARCH_MAX_LIMIT + 1) }),
    ).toThrow();
  });

  it('rejects a negative offset', () => {
    expect(() => customerSearchQuerySchema.parse({ offset: '-1' })).toThrow();
  });

  it('splits a comma-separated ids list and trims each entry', () => {
    const parsed = customerSearchQuerySchema.parse({ ids: 'a, b ,c' });
    expect(parsed.ids).toEqual(['a', 'b', 'c']);
  });

  it('rejects a bare ids= rather than reading it as "no filter"', () => {
    expect(() => customerSearchQuerySchema.parse({ ids: '' })).toThrow();
    expect(() => customerSearchQuerySchema.parse({ ids: ' , , ' })).toThrow();
  });

  it('caps the id list at the same ceiling a page obeys', () => {
    const tooMany = Array.from({ length: CUSTOMER_SEARCH_MAX_LIMIT + 1 }, (_, i) => `id-${i}`);
    expect(() => customerSearchQuerySchema.parse({ ids: tooMany.join(',') })).toThrow();

    const atLimit = Array.from({ length: CUSTOMER_SEARCH_MAX_LIMIT }, (_, i) => `id-${i}`);
    expect(customerSearchQuerySchema.parse({ ids: atLimit.join(',') }).ids).toHaveLength(
      CUSTOMER_SEARCH_MAX_LIMIT,
    );
  });

  it('refuses ids and q together rather than silently preferring one', () => {
    expect(() => customerSearchQuerySchema.parse({ ids: 'a,b', q: 'acme' })).toThrow();

    expect(customerSearchQuerySchema.parse({ ids: 'a,b', q: '' }).ids).toEqual(['a', 'b']);
  });

  it('leaves ids absent when the param is not given', () => {
    expect(customerSearchQuerySchema.parse({}).ids).toBeUndefined();
  });

  it('takes a rep and trims it', () => {
    expect(customerSearchQuerySchema.parse({ accountRepUsername: ' jsmith ' })).toMatchObject({
      accountRepUsername: 'jsmith',
    });
  });

  it('rejects a bare accountRepUsername= rather than reading it as "no filter"', () => {
    expect(() => customerSearchQuerySchema.parse({ accountRepUsername: '' })).toThrow();
    expect(() => customerSearchQuerySchema.parse({ accountRepUsername: '   ' })).toThrow();
  });

  it('refuses ids and a rep together, like ids and q', () => {
    expect(() =>
      customerSearchQuerySchema.parse({ ids: 'a,b', accountRepUsername: 'jsmith' }),
    ).toThrow();
  });

  it('leaves the rep absent when the param is not given', () => {
    expect(customerSearchQuerySchema.parse({}).accountRepUsername).toBeUndefined();
  });

  it('reads creditHold=true and creditHold=false as the booleans they name', () => {
    expect(customerSearchQuerySchema.parse({ creditHold: 'true' }).creditHold).toBe(true);

    expect(customerSearchQuerySchema.parse({ creditHold: 'false' }).creditHold).toBe(false);
  });

  it('leaves the hold filter absent when the param is not given', () => {
    expect(customerSearchQuerySchema.parse({}).creditHold).toBeUndefined();
  });

  it('refuses any other hold value rather than guessing which list was meant', () => {
    for (const value of ['1', 'yes', 'TRUE', '']) {
      expect(customerSearchQuerySchema.safeParse({ creditHold: value }).success).toBe(false);
    }
  });

  it('refuses ids and a hold filter together, either value, like ids and q', () => {
    for (const creditHold of ['true', 'false']) {
      const result = customerSearchQuerySchema.safeParse({ ids: 'a,b', creditHold });
      expect(result.success).toBe(false);
      expect(result.error?.issues.map((issue) => issue.message)).toContain(
        'ids and creditHold cannot be combined — a lookup by id is not a search',
      );
    }
  });
});

describe('the suggestion list', () => {
  it('carries three fields and nothing else', () => {
    const parsed = customerNameSchema.parse({
      id: 'c1',
      name: 'Acme',
      legacyAccountNumber: 'LA-1',
      creditHold: true,
      billingAddress: { line1: '1 Test Way', city: 'Demo Falls', state: 'ID', postalCode: '83010' },
    });
    expect(parsed).toEqual({ id: 'c1', name: 'Acme', legacyAccountNumber: 'LA-1' });
  });

  it('accepts an account with no legacy account number', () => {
    expect(customerNameSchema.parse({ id: 'c1', name: 'Acme' }).legacyAccountNumber).toBe(
      undefined,
    );
  });

  it('rejects an empty name, which nothing could suggest', () => {
    expect(() => customerNameSchema.parse({ id: 'c1', name: '' })).toThrow();
  });

  it('carries the size of the base beside the items', () => {
    const parsed = customerNameListResponseSchema.parse({
      items: [{ id: 'c1', name: 'Acme' }],
      total: 1874,
    });
    expect(parsed.total).toBe(1874);
  });

  it('caps a suggestion list well above the search page limit', () => {
    expect(CUSTOMER_NAME_LIST_MAX).toBeGreaterThan(1000);

    expect(CUSTOMER_NAME_LIST_MAX).toBeGreaterThan(CUSTOMER_SEARCH_MAX_LIMIT);
  });
});

describe('customer terms & tax', () => {
  it('defaults a new customer to Net 30, taxable, non-reseller', () => {
    const parsed = createCustomerRequestSchema.parse({ name: 'Acme' });
    expect(parsed.paymentTerms).toEqual({ netDays: DEFAULT_NET_DAYS });
    expect(parsed.taxExempt).toBe(false);
    expect(parsed.reseller).toBe(false);
  });

  it('refuses payable-on-delivery terms', () => {
    expect(() =>
      createCustomerRequestSchema.parse({
        name: 'Acme',
        paymentTerms: { kind: 'payable_on_delivery' },
      }),
    ).toThrow();
  });

  it('strips a leftover kind rather than storing it', () => {
    const parsed = createCustomerRequestSchema.parse({
      name: 'Acme',
      paymentTerms: { kind: 'net', netDays: 45 },
    });
    expect(parsed.paymentTerms).toEqual({ netDays: 45 });
    expect(parsed.paymentTerms).not.toHaveProperty('kind');
  });

  it('rejects terms with no netDays, and non-positive or absurd day counts', () => {
    for (const paymentTerms of [
      {},
      { netDays: 0 },
      { netDays: -15 },
      { netDays: 27.3 },
      { netDays: 400 },
    ]) {
      expect(() => createCustomerRequestSchema.parse({ name: 'Acme', paymentTerms })).toThrow();
    }
  });

  it('carries exemption and reseller independently — a customer can hold either, both, or neither', () => {
    const parsed = createCustomerRequestSchema.parse({
      name: 'Demo Printers',
      taxExempt: true,
      taxExemptionDocRef: 'exempt-cert-2026.pdf',
      reseller: true,

      taxJurisdiction: 'WA-0202',
    });
    expect(parsed.taxExempt).toBe(true);
    expect(parsed.reseller).toBe(true);
    expect(parsed.taxExemptionDocRef).toBe('exempt-cert-2026.pdf');
    expect(parsed.taxJurisdiction).toBe('WA-0202');
  });

  it('does not carry a tax rate — rates resolve per destination, not per customer', () => {
    const parsed = createCustomerRequestSchema.parse({ name: 'Acme', taxRate: 0.074 });
    expect(parsed).not.toHaveProperty('taxRate');
  });

  it('allows patching terms wholesale, and leaves them alone when absent', () => {
    const swapped = updateCustomerRequestSchema.parse({
      lockVersion: 1,
      paymentTerms: { netDays: 45 },
    });
    expect(swapped.paymentTerms).toEqual({ netDays: 45 });

    const untouched = updateCustomerRequestSchema.parse({ name: 'Acme LLC', lockVersion: 1 });
    expect(untouched.paymentTerms).toBeUndefined();
    expect(untouched.taxExempt).toBeUndefined();
  });

  it('accepts a complete billing address on create', () => {
    const parsed = createCustomerRequestSchema.parse({
      name: 'Acme',
      billingAddress: {
        name: 'Accounts Payable',
        line1: '310 Demo Avenue',
        city: 'Demo Landing',
        state: 'wa',
        postalCode: '99000',
      },
    });
    expect(parsed.billingAddress?.line1).toBe('310 Demo Avenue');

    expect(parsed.billingAddress?.state).toBe('WA');
  });

  it('leaves the billing address absent when none is given', () => {
    const parsed = createCustomerRequestSchema.parse({ name: 'Acme' });
    expect(parsed.billingAddress).toBeUndefined();
  });

  it('refuses a partial billing address rather than storing half of one', () => {
    expect(() =>
      createCustomerRequestSchema.parse({
        name: 'Acme',

        billingAddress: { line1: '4471 Mill Road', city: 'Demo Falls' },
      }),
    ).toThrow();
  });

  it('patches the billing address wholesale, and leaves it alone when absent', () => {
    const replaced = updateCustomerRequestSchema.parse({
      lockVersion: 1,
      billingAddress: {
        line1: '4471 Mill Road',
        city: 'Demo Falls',
        state: 'ID',
        postalCode: '83010',
      },
    });
    expect(replaced.billingAddress?.city).toBe('Demo Falls');

    const untouched = updateCustomerRequestSchema.parse({ name: 'Acme LLC', lockVersion: 1 });
    expect(untouched.billingAddress).toBeUndefined();
  });

  it('refuses a single-field billing patch — merging would leave the old street', () => {
    expect(() =>
      updateCustomerRequestSchema.parse({
        billingAddress: { city: 'Sample Harbor' },
        lockVersion: 1,
      }),
    ).toThrow();
  });

  it('accepts a complete shipping address on create, beside the billing one', () => {
    const parsed = createCustomerRequestSchema.parse({
      name: 'Acme',
      billingAddress: {
        name: 'Accounts Payable',
        line1: '310 Demo Avenue',
        city: 'Demo Landing',
        state: 'WA',
        postalCode: '99000',
      },
      shippingAddress: {
        name: 'Receiving',
        line1: '400 Warehouse Way',
        city: 'Sample Harbor',
        state: 'wa',
        postalCode: '98000-6153',
      },
    });
    expect(parsed.billingAddress?.line1).toBe('310 Demo Avenue');
    expect(parsed.shippingAddress?.line1).toBe('400 Warehouse Way');

    expect(parsed.shippingAddress?.state).toBe('WA');
  });

  it('leaves the shipping address absent when none is given', () => {
    const parsed = createCustomerRequestSchema.parse({ name: 'Acme' });
    expect(parsed.shippingAddress).toBeUndefined();
  });

  it('refuses a partial shipping address rather than storing half of one', () => {
    expect(() =>
      createCustomerRequestSchema.parse({
        name: 'Acme',
        shippingAddress: { line1: '400 Warehouse Way', city: 'Sample Harbor' },
      }),
    ).toThrow();
  });

  it('patches the shipping address wholesale, and leaves it alone when absent', () => {
    const replaced = updateCustomerRequestSchema.parse({
      lockVersion: 1,
      shippingAddress: {
        line1: '400 Warehouse Way',
        city: 'Sample Harbor',
        state: 'WA',
        postalCode: '98000',
      },
    });
    expect(replaced.shippingAddress?.city).toBe('Sample Harbor');

    const untouched = updateCustomerRequestSchema.parse({ name: 'Acme LLC', lockVersion: 1 });
    expect(untouched.shippingAddress).toBeUndefined();
  });

  it('refuses a single-field shipping patch — merging would leave the old street', () => {
    expect(() =>
      updateCustomerRequestSchema.parse({
        shippingAddress: { city: 'Sample Harbor' },
        lockVersion: 1,
      }),
    ).toThrow();
  });

  describe('null clears, absent leaves alone', () => {
    it.each([
      ['legacyAccountNumber'],
      ['legacyUmbrellaAccountNumber'],
      ['taxJurisdiction'],
      ['taxExemptionDocRef'],
      ['freightMarginPct'],
      ['billingAddress'],
      ['shippingAddress'],
    ] as const)('accepts null for %s', (field) => {
      const parsed = updateCustomerRequestSchema.parse({ [field]: null, lockVersion: 1 });
      expect(parsed[field]).toBeNull();
    });

    it('distinguishes absent from null', () => {
      const cleared = updateCustomerRequestSchema.parse({ taxJurisdiction: null, lockVersion: 1 });
      const untouched = updateCustomerRequestSchema.parse({ name: 'Acme', lockVersion: 1 });
      expect(cleared.taxJurisdiction).toBeNull();
      expect(untouched.taxJurisdiction).toBeUndefined();
    });

    it('refuses null for paymentTerms - an account always has terms', () => {
      expect(() =>
        updateCustomerRequestSchema.parse({ paymentTerms: null, lockVersion: 1 }),
      ).toThrow();
    });

    it.each([['name'], ['taxExempt'], ['reseller']] as const)(
      'refuses null for the required scalar %s',
      (field) => {
        expect(() =>
          updateCustomerRequestSchema.parse({ [field]: null, lockVersion: 1 }),
        ).toThrow();
      },
    );

    it('still refuses a partial address when one is supplied', () => {
      expect(() =>
        updateCustomerRequestSchema.parse({
          billingAddress: { city: 'Sample Harbor' },
          lockVersion: 1,
        }),
      ).toThrow();
    });

    it('requires the lockVersion, so a patch that forgets it cannot clobber', () => {
      expect(() => updateCustomerRequestSchema.parse({ name: 'Acme' })).toThrow();
      expect(() => updateCustomerRequestSchema.parse({ name: 'Acme', lockVersion: 0 })).toThrow();
      expect(() => updateCustomerRequestSchema.parse({ name: 'Acme', lockVersion: 2.7 })).toThrow();
    });

    it('requires the lockVersion on a credit hold too, with no protective exception', () => {
      expect(() => setCreditHoldRequestSchema.parse({ held: true })).toThrow();
      expect(setCreditHoldRequestSchema.parse({ held: true, lockVersion: 3 })).toEqual({
        held: true,
        lockVersion: 3,
      });
    });

    it('still validates a non-null value', () => {
      expect(() =>
        updateCustomerRequestSchema.parse({ legacyAccountNumber: '', lockVersion: 1 }),
      ).toThrow();
      expect(() =>
        updateCustomerRequestSchema.parse({ freightMarginPct: '3.2', lockVersion: 1 }),
      ).toThrow();
    });
  });
});
