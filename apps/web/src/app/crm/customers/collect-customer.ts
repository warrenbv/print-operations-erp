// Reads the customer form into the API's request shapes. Each function returns the request or one message.
// The freight margin is typed as a percent and sent as a ratio: apps/web/src/lib/percent.ts.
// A customer added for a quote needs a billing address and a contact with an email, because the quote is
// emailed to the customer's contacts: docs/product/requirements.md (R1).
import {
  CONTACT_NEEDS_NAME_OR_EMAIL,
  createContactRequestSchema,
  createCustomerRequestSchema,
  updateCustomerRequestSchema,
  type CreateContactRequest,
  type CreateCustomerRequest,
  type UpdateCustomerRequest,
} from '@erp/types';
import { optionalString } from '@erp/utils';

import { percentToRatio } from '../../../lib/percent';

export type Collected<T> = { ok: true; request: T } | { ok: false; message: string };

export { ratioToPercent } from '../../../lib/percent';

function collectMargin(percent: string): Collected<string> {
  const converted = percentToRatio(percent, {
    subject: 'freight margin',

    maxExclusive: '1',
  });
  return converted.ok ? { ok: true, request: converted.ratio } : converted;
}

function readAddress(formData: FormData, prefix: 'billing' | 'shipping'): Record<string, string> {
  return {
    ...optionalField(formData, `${prefix}Name`, 'name'),
    ...optionalField(formData, `${prefix}Line1`, 'line1'),
    ...optionalField(formData, `${prefix}Line2`, 'line2'),
    ...optionalField(formData, `${prefix}City`, 'city'),
    ...optionalField(formData, `${prefix}State`, 'state'),
    ...optionalField(formData, `${prefix}PostalCode`, 'postalCode'),
  };
}

function readOptionalAddress(
  formData: FormData,
  prefix: 'billing' | 'shipping',
): Record<string, string> | undefined {
  const parts = readAddress(formData, prefix);

  return Object.keys(parts).length === 0 ? undefined : parts;
}

export const SAME_AS_BILLING_FIELD = 'shippingSameAsBilling';

export const SAME_AS_BILLING_NEEDS_BILLING = 'Same as billing needs a billing address to copy.';

export const SHIPPING_FIELDSET_CLASS = 'shipping-address';

export const SHIPPING_BOXES_CLASS = 'shipping-boxes';

// Hides the shipping boxes with CSS alone while Same as billing is ticked, because pages run no
// client script: docs/decisions/004-server-first-web-ui.md.
export const SAME_AS_BILLING_REVEAL_CSS = `
.${SHIPPING_FIELDSET_CLASS}:has(input[name="${SAME_AS_BILLING_FIELD}"]:checked) .${SHIPPING_BOXES_CLASS} {
  display: none;
}
`;

function sameAsBilling(formData: FormData): boolean {
  return formData.get(SAME_AS_BILLING_FIELD) !== null;
}

function readShared(formData: FormData): Collected<Record<string, unknown>> {
  const name = optionalString(formData, 'name');
  if (name === undefined) {
    return { ok: false, message: 'a customer name is required.' };
  }

  const netDays = optionalString(formData, 'netDays');
  if (netDays === undefined) {
    return { ok: false, message: 'net terms need a number of days — 30 is the house default.' };
  }
  if (!/^\d+$/.test(netDays)) {
    return { ok: false, message: `net days must be a whole number — you entered "${netDays}".` };
  }

  const paymentTerms = { netDays: Number(netDays) };

  return {
    ok: true,
    request: {
      name,
      paymentTerms,

      taxExempt: formData.get('taxExempt') !== null,
      reseller: formData.get('reseller') !== null,
    },
  };
}

export function collectCreate(formData: FormData): Collected<CreateCustomerRequest> {
  const shared = readShared(formData);
  if (!shared.ok) {
    return shared;
  }

  const margin = optionalString(formData, 'freightMarginPct');
  let freightMarginPct: string | undefined;
  if (margin !== undefined) {
    const converted = collectMargin(margin);
    if (!converted.ok) {
      return converted;
    }
    freightMarginPct = converted.request;
  }

  const billingAddress = readOptionalAddress(formData, 'billing');
  const copyBilling = sameAsBilling(formData);
  if (copyBilling && billingAddress === undefined) {
    return { ok: false, message: SAME_AS_BILLING_NEEDS_BILLING };
  }

  // Same as billing stores a copy. A later change to the billing address does not follow it.
  const shippingAddress = copyBilling ? undefined : readOptionalAddress(formData, 'shipping');

  const parsed = createCustomerRequestSchema.safeParse({
    ...shared.request,
    ...optionalField(formData, 'legacyAccountNumber'),
    ...optionalField(formData, 'legacyUmbrellaAccountNumber'),
    ...optionalField(formData, 'taxJurisdiction'),
    ...optionalField(formData, 'taxExemptionDocRef'),
    ...(freightMarginPct === undefined ? {} : { freightMarginPct }),
    ...(billingAddress === undefined ? {} : { billingAddress }),
    ...(shippingAddress === undefined ? {} : { shippingAddress }),

    ...optionalField(formData, 'accountRepUsername'),
  });
  if (!parsed.success) {
    return { ok: false, message: firstIssue(parsed.error.issues) };
  }

  return {
    ok: true,
    request: copyBilling
      ? { ...parsed.data, shippingAddress: parsed.data.billingAddress }
      : parsed.data,
  };
}

export const QUOTE_CONTACT_NEEDS_EMAIL =
  'a quote is emailed, so the contact needs an email address.';

export function collectForQuote(
  formData: FormData,
  customer: CreateCustomerRequest,
): Collected<CreateContactRequest> {
  if (customer.billingAddress === undefined) {
    return {
      ok: false,
      message: 'a quote needs a billing address — street, city, state and ZIP.',
    };
  }

  const name = optionalString(formData, 'contactName');
  const email = optionalString(formData, 'contactEmail');
  if (name === undefined && email === undefined) {
    return { ok: false, message: CONTACT_NEEDS_NAME_OR_EMAIL };
  }
  if (email === undefined) {
    return { ok: false, message: QUOTE_CONTACT_NEEDS_EMAIL };
  }

  const parsed = createContactRequestSchema.safeParse({
    ...(name === undefined ? {} : { name }),
    email,
  });
  if (!parsed.success) {
    return { ok: false, message: firstIssue(parsed.error.issues) };
  }
  return { ok: true, request: parsed.data };
}

export function collectUpdate(formData: FormData): Collected<UpdateCustomerRequest> {
  const shared = readShared(formData);
  if (!shared.ok) {
    return shared;
  }

  const lockVersion = optionalString(formData, 'lockVersion');
  if (lockVersion === undefined || !/^\d+$/.test(lockVersion)) {
    return {
      ok: false,
      message: 'this form is missing its version marker - reload the customer and try again.',
    };
  }

  const margin = optionalString(formData, 'freightMarginPct');
  let freightMarginPct: string | null = null;
  if (margin !== undefined) {
    const converted = collectMargin(margin);
    if (!converted.ok) {
      return converted;
    }
    freightMarginPct = converted.request;
  }

  const billingAddress = readOptionalAddress(formData, 'billing') ?? null;
  const copyBilling = sameAsBilling(formData);
  if (copyBilling && billingAddress === null) {
    return { ok: false, message: SAME_AS_BILLING_NEEDS_BILLING };
  }

  const parsed = updateCustomerRequestSchema.safeParse({
    ...shared.request,
    legacyAccountNumber: optionalString(formData, 'legacyAccountNumber') ?? null,
    legacyUmbrellaAccountNumber: optionalString(formData, 'legacyUmbrellaAccountNumber') ?? null,
    taxJurisdiction: optionalString(formData, 'taxJurisdiction') ?? null,
    taxExemptionDocRef: optionalString(formData, 'taxExemptionDocRef') ?? null,
    freightMarginPct,
    billingAddress,

    ...(copyBilling ? {} : { shippingAddress: readOptionalAddress(formData, 'shipping') ?? null }),

    accountRepUsername: optionalString(formData, 'accountRepUsername') ?? null,
    lockVersion: Number(lockVersion),
  });
  if (!parsed.success) {
    return { ok: false, message: firstIssue(parsed.error.issues) };
  }
  return {
    ok: true,
    request: copyBilling
      ? { ...parsed.data, shippingAddress: parsed.data.billingAddress ?? null }
      : parsed.data,
  };
}

function firstIssue(issues: readonly { path: PropertyKey[]; message: string }[]): string {
  const issue = issues[0];
  return issue === undefined ? 'invalid input' : `${issue.path.join('.')}: ${issue.message}`;
}

function optionalField(form: FormData, key: string, as: string = key): Record<string, string> {
  const value = optionalString(form, key);
  return value === undefined ? {} : { [as]: value };
}
