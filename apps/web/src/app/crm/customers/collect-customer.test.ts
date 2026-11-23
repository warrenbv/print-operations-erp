// Tests reading the customer form: create, update, the freight margin, Same as billing and a customer added for a quote.
import { CONTACT_NEEDS_NAME_OR_EMAIL } from '@erp/types';
import { describe, expect, it } from 'vitest';

import {
  collectCreate,
  collectForQuote,
  collectUpdate,
  QUOTE_CONTACT_NEEDS_EMAIL,
  ratioToPercent,
  SAME_AS_BILLING_FIELD,
  SAME_AS_BILLING_NEEDS_BILLING,
  SAME_AS_BILLING_REVEAL_CSS,
  SHIPPING_BOXES_CLASS,
  SHIPPING_FIELDSET_CLASS,
} from './collect-customer';

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    data.set(key, value);
  }
  return data;
}

const EDIT_MINIMUM = { lockVersion: '1' };

const MINIMUM = { name: 'Example Demo Foods', netDays: '30' };

const ADDRESS_FIELDS = {
  billingName: 'Accounts Payable',
  billingLine1: 'PO Box 100',
  billingLine2: 'Attn: Casey Demo',
  billingCity: 'Demo Landing',
  billingState: 'wa',
  billingPostalCode: '99000',
};

const SHIPPING_FIELDS = {
  shippingName: 'Receiving',
  shippingLine1: '500 Sample Road',
  shippingLine2: 'Dock 3',
  shippingCity: 'Sample Harbor',
  shippingState: 'wa',
  shippingPostalCode: '98000-6052',
};

describe('collectCreate', () => {
  it('builds the minimum valid customer', () => {
    const result = collectCreate(form(MINIMUM));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.request.name).toBe('Example Demo Foods');
    expect(result.request.paymentTerms).toEqual({ netDays: 30 });
    expect(result.request.taxExempt).toBe(false);
    expect(result.request.reseller).toBe(false);
  });

  it('omits blank optional fields rather than sending empty strings', () => {
    const result = collectCreate(
      form({ ...MINIMUM, legacyAccountNumber: '', taxJurisdiction: '   ' }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.request).not.toHaveProperty('legacyAccountNumber');
    expect(result.request).not.toHaveProperty('taxJurisdiction');
    expect(result.request).not.toHaveProperty('billingAddress');
    expect(result.request).not.toHaveProperty('shippingAddress');
  });

  it('carries every optional field when they are filled', () => {
    const result = collectCreate(
      form({
        ...MINIMUM,
        ...ADDRESS_FIELDS,
        ...SHIPPING_FIELDS,
        legacyAccountNumber: 'LA-1',
        legacyUmbrellaAccountNumber: 'LA-UMB',
        taxJurisdiction: 'WA-9010',
        taxExemptionDocRef: 'exempt-2026.pdf',
        taxExempt: 'on',
        reseller: 'on',
        freightMarginPct: '12',
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.request.legacyAccountNumber).toBe('LA-1');
    expect(result.request.taxExempt).toBe(true);
    expect(result.request.reseller).toBe(true);
    expect(result.request.billingAddress?.line1).toBe('PO Box 100');

    expect(result.request.billingAddress?.state).toBe('WA');

    expect(result.request.shippingAddress?.line1).toBe('500 Sample Road');
    expect(result.request.shippingAddress?.name).toBe('Receiving');
    expect(result.request.shippingAddress?.postalCode).toBe('98000-6052');
    expect(result.request.shippingAddress?.state).toBe('WA');
  });

  it('refuses a bare state as the default tax jurisdiction, with the format', () => {
    const rule =
      'tax jurisdiction must be ID, or WA- and the four-digit DOR location code, ' +
      'such as WA-0202 for Clarkston.';
    expect(collectCreate(form({ ...MINIMUM, taxJurisdiction: 'WA' }))).toEqual({
      ok: false,
      message: `taxJurisdiction: ${rule}`,
    });
    expect(collectUpdate(form({ ...MINIMUM, lockVersion: '1', taxJurisdiction: 'WA' }))).toEqual({
      ok: false,
      message: `taxJurisdiction: ${rule}`,
    });
  });

  it('takes a shipping address with no billing address, and the other way round', () => {
    const shipOnly = collectCreate(form({ ...MINIMUM, ...SHIPPING_FIELDS }));
    expect(shipOnly.ok).toBe(true);
    if (!shipOnly.ok) return;
    expect(shipOnly.request).not.toHaveProperty('billingAddress');
    expect(shipOnly.request.shippingAddress?.city).toBe('Sample Harbor');

    const billOnly = collectCreate(form({ ...MINIMUM, ...ADDRESS_FIELDS }));
    expect(billOnly.ok).toBe(true);
    if (!billOnly.ok) return;
    expect(billOnly.request).not.toHaveProperty('shippingAddress');
    expect(billOnly.request.billingAddress?.city).toBe('Demo Landing');
  });

  it('refuses a half-filled shipping address naming the missing part', () => {
    const result = collectCreate(
      form({ ...MINIMUM, shippingLine1: '500 Sample Road', shippingCity: 'Sample Harbor' }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain('shippingAddress');
  });

  it('reads a ticked checkbox as true and an absent one as false', () => {
    const ticked = collectCreate(form({ ...MINIMUM, taxExempt: 'on' }));
    expect(ticked.ok && ticked.request.taxExempt).toBe(true);
    const unticked = collectCreate(form(MINIMUM));
    expect(unticked.ok && unticked.request.taxExempt).toBe(false);
  });

  it('always builds net terms, whatever the form carries', () => {
    const result = collectCreate(form({ ...MINIMUM, paymentTermsKind: 'payable_on_delivery' }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.request.paymentTerms).toEqual({ netDays: 30 });
  });

  it('refuses a submit with no name', () => {
    const result = collectCreate(form({ netDays: '30' }));
    expect(result).toEqual({ ok: false, message: 'a customer name is required.' });
  });

  it('refuses a partial billing address, naming the missing part', () => {
    const result = collectCreate(form({ ...MINIMUM, billingCity: 'Sample Harbor' }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain('line1');
    expect(result.message).toBe('billingAddress.line1: Required');
  });
});

describe('the freight margin is a percent on the way in, a ratio on the way out', () => {
  it.each([
    ['12', '0.120000'],
    ['0', '0.000000'],
    ['23.5', '0.235000'],

    ['16.7', '0.167000'],
    ['99.9999', '0.999999'],
  ])('converts %s%% to %s', (percent, ratio) => {
    const result = collectCreate(form({ ...MINIMUM, freightMarginPct: percent }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.request.freightMarginPct).toBe(ratio);
  });

  it('refuses 100% or more, naming the percent that was typed', () => {
    const result = collectCreate(form({ ...MINIMUM, freightMarginPct: '248' }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain('248%');
  });

  it('refuses text that is not a number', () => {
    const result = collectCreate(form({ ...MINIMUM, freightMarginPct: '12%' }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain('12%');
  });

  it.each([
    ['0.120000', '12'],
    ['0.000000', '0'],
    ['0.235000', '23.5'],
    ['0.384217', '38.4217'],
  ])('renders the stored ratio %s into the input as %s', (ratio, percent) => {
    expect(ratioToPercent(ratio)).toBe(percent);
  });

  it('round-trips a stored ratio through the form without altering it', () => {
    const stored = '0.384217';
    const result = collectUpdate(
      form({ ...MINIMUM, ...EDIT_MINIMUM, freightMarginPct: ratioToPercent(stored) }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.request.freightMarginPct).toBe(stored);
  });
});

describe('collectUpdate', () => {
  it('sends null for a blank optional field, which clears it', () => {
    const result = collectUpdate(form({ ...MINIMUM, ...EDIT_MINIMUM }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.request.legacyAccountNumber).toBeNull();
    expect(result.request.legacyUmbrellaAccountNumber).toBeNull();
    expect(result.request.taxJurisdiction).toBeNull();
    expect(result.request.taxExemptionDocRef).toBeNull();
    expect(result.request.freightMarginPct).toBeNull();
    expect(result.request.billingAddress).toBeNull();
    expect(result.request.shippingAddress).toBeNull();
  });

  it('sends the value when the field is filled', () => {
    const result = collectUpdate(
      form({
        ...MINIMUM,
        ...EDIT_MINIMUM,
        ...ADDRESS_FIELDS,
        ...SHIPPING_FIELDS,
        taxJurisdiction: 'ID',
        freightMarginPct: '12',
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.request.taxJurisdiction).toBe('ID');
    expect(result.request.freightMarginPct).toBe('0.120000');
    expect(result.request.billingAddress).toMatchObject({ city: 'Demo Landing', state: 'WA' });
    expect(result.request.shippingAddress).toMatchObject({
      city: 'Sample Harbor',
      name: 'Receiving',
    });
  });

  it('clears one address while keeping the other', () => {
    const result = collectUpdate(form({ ...MINIMUM, ...EDIT_MINIMUM, ...ADDRESS_FIELDS }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.request.shippingAddress).toBeNull();
    expect(result.request.billingAddress).toMatchObject({ city: 'Demo Landing' });
  });

  it('clears the whole address when every one of its six inputs is blank', () => {
    const result = collectUpdate(
      form({
        ...MINIMUM,
        ...EDIT_MINIMUM,
        billingName: '',
        billingLine1: '',
        billingLine2: '',
        billingCity: '',
        billingState: '',
        billingPostalCode: '',
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.request.billingAddress).toBeNull();
  });

  it('never sends null for payment terms, which are not nullable', () => {
    const result = collectUpdate(form({ ...MINIMUM, ...EDIT_MINIMUM }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.request.paymentTerms).toEqual({ netDays: 30 });
  });

  it('carries the lockVersion the form was rendered from', () => {
    const result = collectUpdate(form({ ...MINIMUM, lockVersion: '7' }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.request.lockVersion).toBe(7);
  });

  it('refuses a submit with no lockVersion rather than clobbering', () => {
    const result = collectUpdate(form(MINIMUM));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain('reload the customer');
  });

  it('refuses a lockVersion that is not a whole number', () => {
    const result = collectUpdate(form({ ...MINIMUM, lockVersion: 'abc' }));
    expect(result.ok).toBe(false);
  });

  it('refuses a partial address rather than clearing it', () => {
    const result = collectUpdate(
      form({ ...MINIMUM, ...EDIT_MINIMUM, billingCity: 'Sample Harbor' }),
    );
    expect(result.ok).toBe(false);
  });

  it('refuses net days that are not a whole number', () => {
    const result = collectUpdate(form({ ...MINIMUM, ...EDIT_MINIMUM, netDays: '22.5' }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain('22.5');
  });
});

describe('"Same as billing"', () => {
  const TICK = { [SAME_AS_BILLING_FIELD]: 'on' };

  const HIDDEN_JUNK = { shippingLine1: 'Junk Road', shippingCity: 'Nowhere' };

  const BILLING_AS_STORED = {
    name: 'Accounts Payable',
    line1: 'PO Box 100',
    line2: 'Attn: Casey Demo',
    city: 'Demo Landing',
    state: 'WA',
    postalCode: '99000',
  };

  const SHIPPING_AS_STORED = {
    name: 'Receiving',
    line1: '500 Sample Road',
    line2: 'Dock 3',
    city: 'Sample Harbor',
    state: 'WA',
    postalCode: '98000-6052',
  };

  const VERBS = [
    {
      verb: 'create',
      collect: (fields: Record<string, string>) => collectCreate(form({ ...MINIMUM, ...fields })),
    },
    {
      verb: 'edit',
      collect: (fields: Record<string, string>) =>
        collectUpdate(form({ ...MINIMUM, ...EDIT_MINIMUM, ...fields })),
    },
  ];

  describe.each(VERBS)('on $verb', ({ collect }) => {
    it('ticked, copies the six billing fields and never reads the shipping boxes', () => {
      const result = collect({ ...ADDRESS_FIELDS, ...HIDDEN_JUNK, ...TICK });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.request.billingAddress).toEqual(BILLING_AS_STORED);
      expect(result.request.shippingAddress).toEqual(BILLING_AS_STORED);
    });

    it('unticked, keeps the shipping boxes as typed', () => {
      const result = collect({ ...ADDRESS_FIELDS, ...SHIPPING_FIELDS });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.request.shippingAddress).toEqual(SHIPPING_AS_STORED);
    });

    it('ticked with a half-filled billing address, reports the billing error only', () => {
      const result = collect({ billingCity: 'Demo Landing', ...HIDDEN_JUNK, ...TICK });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.message).toContain('billingAddress');
      expect(result.message).not.toContain('shippingAddress');
    });

    it('ticked with the billing address blank, refuses rather than copying nothing', () => {
      const result = collect({ ...SHIPPING_FIELDS, ...TICK });
      expect(result).toEqual({ ok: false, message: SAME_AS_BILLING_NEEDS_BILLING });
    });
  });

  it('words the refusal in one plain sentence', () => {
    expect(SAME_AS_BILLING_NEEDS_BILLING).toBe('Same as billing needs a billing address to copy.');
  });

  it('hides the shipping boxes only while the tick is checked', () => {
    expect(SAME_AS_BILLING_REVEAL_CSS).toContain(
      `.${SHIPPING_FIELDSET_CLASS}:has(input[name="${SAME_AS_BILLING_FIELD}"]:checked) .${SHIPPING_BOXES_CLASS} {`,
    );

    expect(SAME_AS_BILLING_REVEAL_CSS.match(/display: none;/g)).toHaveLength(1);
    expect(SAME_AS_BILLING_REVEAL_CSS).not.toContain('display: grid');
  });
});

describe('collectForQuote', () => {
  const CONTACT_FIELDS = { contactName: 'Casey Demo', contactEmail: 'fixture-25@example.test' };

  function created(fields: Record<string, string>) {
    const collected = collectCreate(form(fields));
    if (!collected.ok) throw new Error(`fixture is not a valid customer: ${collected.message}`);
    return collected.request;
  }

  it('takes the contact the quote will be emailed to', () => {
    const fields = { ...MINIMUM, ...ADDRESS_FIELDS, ...CONTACT_FIELDS };
    const result = collectForQuote(form(fields), created(fields));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.request).toEqual({ name: 'Casey Demo', email: 'fixture-25@example.test' });
  });

  it('refuses a customer with no billing address', () => {
    const fields = { ...MINIMUM, ...CONTACT_FIELDS };
    const result = collectForQuote(form(fields), created(fields));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain('billing address');
  });

  it('refuses a contact with no email address, a name alone included', () => {
    const fields = { ...MINIMUM, ...ADDRESS_FIELDS, contactName: 'Casey Demo' };
    const result = collectForQuote(form(fields), created(fields));
    expect(result).toEqual({ ok: false, message: QUOTE_CONTACT_NEEDS_EMAIL });
    expect(QUOTE_CONTACT_NEEDS_EMAIL).toBe(
      'a quote is emailed, so the contact needs an email address.',
    );
  });

  it('takes a contact that is an email address alone, sending no name', () => {
    const fields = { ...MINIMUM, ...ADDRESS_FIELDS, contactEmail: 'fixture-07@example.test' };
    const result = collectForQuote(form(fields), created(fields));
    expect(result).toEqual({ ok: true, request: { email: 'fixture-07@example.test' } });
  });

  it("refuses a name and an email both blank, in the contact form's words", () => {
    const fields = { ...MINIMUM, ...ADDRESS_FIELDS, contactName: '  ', contactEmail: '' };
    const result = collectForQuote(form(fields), created(fields));
    expect(result).toEqual({ ok: false, message: CONTACT_NEEDS_NAME_OR_EMAIL });
  });

  it('refuses an email the contact schema does not accept', () => {
    const fields = {
      ...MINIMUM,
      ...ADDRESS_FIELDS,
      contactName: 'Casey Demo',
      contactEmail: 'jane',
    };
    const result = collectForQuote(form(fields), created(fields));
    expect(result.ok).toBe(false);
  });

  it('reads the prefixed fields, never the account name', () => {
    const fields = { ...MINIMUM, ...ADDRESS_FIELDS, ...CONTACT_FIELDS };
    const result = collectForQuote(form(fields), created(fields));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.request.name).not.toBe('Example Demo Foods');
  });
});
