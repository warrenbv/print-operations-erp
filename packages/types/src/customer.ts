// The customer record, customer search and the credit hold.
// A customer on credit hold cannot have a new quote created: docs/product/requirements.md (R2). The Billing
// Manager or an Admin sets the hold, through `CREDIT_HOLD_ROLES` in packages/types/src/roles.ts.
import { z } from 'zod';

import { freightMarginPctSchema } from './freight';
import { postalAddressSchema, type PostalAddress } from './postal-address';
import { taxJurisdictionKeySchema } from './revenue';
import { salesRepUsernameSchema } from './sales-rep';

const trimmedName = z.string().trim().min(1).max(255);

const legacyAccountNumber = z.string().trim().min(1).max(64);

export const customerIdSchema = z.string().min(1);

export const DEFAULT_NET_DAYS = 15;

export const paymentTermsSchema = z.object({
  netDays: z.number().int().positive().max(365),
});

export type PaymentTerms = z.infer<typeof paymentTermsSchema>;

export const DEFAULT_PAYMENT_TERMS: PaymentTerms = { netDays: DEFAULT_NET_DAYS };

const taxJurisdiction = z.string().trim().min(1).max(64);

const taxExemptionDocRef = z.string().trim().min(1).max(255);

export const billingAddressSchema = postalAddressSchema;

export type BillingAddress = PostalAddress;

export const shippingAddressSchema = postalAddressSchema;

export type ShippingAddress = PostalAddress;

export const customerSchema = z.object({
  id: customerIdSchema,
  name: trimmedName,
  legacyAccountNumber: legacyAccountNumber.optional(),
  legacyUmbrellaAccountNumber: legacyAccountNumber.optional(),
  paymentTerms: paymentTermsSchema,
  taxJurisdiction: taxJurisdiction.optional(),

  taxExempt: z.boolean(),
  taxExemptionDocRef: taxExemptionDocRef.optional(),
  reseller: z.boolean(),

  billingAddress: billingAddressSchema.optional(),

  shippingAddress: shippingAddressSchema.optional(),

  freightMarginPct: freightMarginPctSchema.optional(),

  accountRepUsername: salesRepUsernameSchema.optional(),

  creditHold: z.boolean(),

  creditHoldSetBy: z.string().trim().min(1).max(128).optional(),
  creditHoldSetAt: z.iso.datetime().optional(),

  lockVersion: z.number().int().min(1).default(1),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export type Customer = z.infer<typeof customerSchema>;

export const createCustomerRequestSchema = z.object({
  name: trimmedName,
  legacyAccountNumber: legacyAccountNumber.optional(),
  legacyUmbrellaAccountNumber: legacyAccountNumber.optional(),

  paymentTerms: paymentTermsSchema.default(DEFAULT_PAYMENT_TERMS),
  taxJurisdiction: taxJurisdictionKeySchema.optional(),
  taxExempt: z.boolean().default(false),
  taxExemptionDocRef: taxExemptionDocRef.optional(),
  reseller: z.boolean().default(false),

  billingAddress: billingAddressSchema.optional(),

  shippingAddress: shippingAddressSchema.optional(),
  freightMarginPct: freightMarginPctSchema.optional(),

  accountRepUsername: salesRepUsernameSchema.optional(),
});

export type CreateCustomerRequest = z.infer<typeof createCustomerRequestSchema>;

export const updateCustomerRequestSchema = z.object({
  name: trimmedName.optional(),
  legacyAccountNumber: legacyAccountNumber.nullable().optional(),
  legacyUmbrellaAccountNumber: legacyAccountNumber.nullable().optional(),

  paymentTerms: paymentTermsSchema.optional(),
  taxJurisdiction: taxJurisdictionKeySchema.nullable().optional(),
  taxExempt: z.boolean().optional(),
  taxExemptionDocRef: taxExemptionDocRef.nullable().optional(),
  reseller: z.boolean().optional(),

  billingAddress: billingAddressSchema.nullable().optional(),

  shippingAddress: shippingAddressSchema.nullable().optional(),

  freightMarginPct: freightMarginPctSchema.nullable().optional(),

  accountRepUsername: salesRepUsernameSchema.nullable().optional(),

  lockVersion: z.number().int().min(1),
});

export type UpdateCustomerRequest = z.infer<typeof updateCustomerRequestSchema>;

export const CUSTOMER_SEARCH_DEFAULT_LIMIT = 20;
export const CUSTOMER_SEARCH_MAX_LIMIT = 100;

export const CUSTOMER_NAME_LIST_MAX = 2000;

export const customerNameSchema = z.object({
  id: customerIdSchema,
  name: z.string().min(1),

  legacyAccountNumber: legacyAccountNumber.optional(),
});

export type CustomerName = z.infer<typeof customerNameSchema>;

export const customerNameListResponseSchema = z.object({
  items: z.array(customerNameSchema),
  total: z.number().int().nonnegative(),
});

export type CustomerNameListResponse = z.infer<typeof customerNameListResponseSchema>;

export const customerSearchQuerySchema = z
  .object({
    q: z.string().trim().max(255).optional(),

    accountRepUsername: salesRepUsernameSchema.optional(),

    creditHold: z
      .enum(['true', 'false'])
      .transform((value) => value === 'true')
      .optional(),

    ids: z
      .string()
      .transform((value) =>
        value
          .split(',')
          .map((part) => part.trim())
          .filter((part) => part !== ''),
      )
      .pipe(z.array(customerIdSchema).min(1).max(CUSTOMER_SEARCH_MAX_LIMIT))
      .optional(),
    limit: z.coerce
      .number()
      .int()
      .positive()
      .max(CUSTOMER_SEARCH_MAX_LIMIT)
      .default(CUSTOMER_SEARCH_DEFAULT_LIMIT),
    offset: z.coerce.number().int().nonnegative().default(0),
  })
  .superRefine((value, ctx) => {
    if (value.ids !== undefined && value.q !== undefined && value.q !== '') {
      ctx.addIssue({
        code: 'custom',
        path: ['ids'],
        message: 'ids and q cannot be combined — a lookup by id is not a search',
      });
    }
    if (value.ids !== undefined && value.accountRepUsername !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['ids'],
        message: 'ids and accountRepUsername cannot be combined — a lookup by id is not a search',
      });
    }
    if (value.ids !== undefined && value.creditHold !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['ids'],
        message: 'ids and creditHold cannot be combined — a lookup by id is not a search',
      });
    }
  });

export type CustomerSearchQuery = z.infer<typeof customerSearchQuerySchema>;

export const customerSearchResponseSchema = z.object({
  items: z.array(customerSchema),
  total: z.number().int().nonnegative(),
});

export type CustomerSearchResponse = z.infer<typeof customerSearchResponseSchema>;

export const setCreditHoldRequestSchema = z.object({
  held: z.boolean(),

  lockVersion: z.number().int().min(1),
});

export type SetCreditHoldRequest = z.infer<typeof setCreditHoldRequestSchema>;
