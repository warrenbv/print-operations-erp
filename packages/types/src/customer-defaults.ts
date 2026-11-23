// A customer's quoting defaults and parts, with any agreed price on a part.
// A new quote for the customer starts from them: apps/web/src/app/quoting/quotes/[id]/customer-seed.ts.
// The limits are mirrored by the customer_defaults and customer_parts checks in infra/db/migrations/crm/0000_baseline.sql.
import { z } from 'zod';

import { customerDescriptionSchema, customerPartNumberSchema } from './customer-part';
import { measureSchema, moneySchema, positiveDecimal } from './decimal';
import { shippingModeSchema } from './freight';
import { pricingBasisSchema } from './pricing-basis';
import { tierCodeSchema } from './pricing-tier';
import { rollWidthSchema } from './roll-width';

export const CUSTOMER_PARTS_MAX = 200;

const partGradeIdSchema = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, 'a grade id');

export const customerPartFeetPerRollSchema = positiveDecimal(
  measureSchema,
  'roll length',
  'measure',
);

const customerPartFields = {
  gradeId: partGradeIdSchema,
  rollWidthIn: rollWidthSchema,
  partNumber: customerPartNumberSchema.optional(),
  description: customerDescriptionSchema.optional(),
  feetPerRoll: customerPartFeetPerRollSchema.optional(),
};

const PART_NEEDS_A_NAME = {
  error: 'a part needs a part number, a description or both',
  path: ['partNumber'],
};

function hasAName(part: { partNumber?: string | undefined; description?: string | undefined }) {
  return part.partNumber !== undefined || part.description !== undefined;
}

export const customerPartSchema = z.object(customerPartFields).refine(hasAName, PART_NEEDS_A_NAME);

export type CustomerPart = z.infer<typeof customerPartSchema>;

export const agreedPriceFigureSchema = positiveDecimal(moneySchema, 'agreed price', 'money');

export const agreedPriceSchema = z.object({
  basis: pricingBasisSchema,
  price: agreedPriceFigureSchema,
  setBy: z.string().trim().min(1).max(128),
  setAt: z.iso.datetime(),
});

export type AgreedPrice = z.infer<typeof agreedPriceSchema>;

export type AgreedPriceTerms = Pick<AgreedPrice, 'basis' | 'price'>;

export const storedCustomerPartSchema = z
  .object({ ...customerPartFields, agreedPrice: agreedPriceSchema.optional() })
  .refine(hasAName, PART_NEEDS_A_NAME);

export type StoredCustomerPart = z.infer<typeof storedCustomerPartSchema>;

const defaultLeadTimeDaysSchema = z.number().int().nonnegative().max(3650);

export const customerDefaultsSchema = z.object({
  customerId: z.string().min(1),
  pricingBasis: pricingBasisSchema.optional(),

  tierCode: tierCodeSchema.optional(),
  freightMode: shippingModeSchema.optional(),
  leadTimeDays: defaultLeadTimeDaysSchema.optional(),

  parts: z.array(storedCustomerPartSchema),
  lockVersion: z.number().int().nonnegative(),

  updatedBy: z.string().trim().min(1).max(128).optional(),
  updatedAt: z.iso.datetime().optional(),
});

export type CustomerDefaults = z.infer<typeof customerDefaultsSchema>;

export const putCustomerDefaultsRequestSchema = z
  .object({
    pricingBasis: pricingBasisSchema.optional(),
    tierCode: tierCodeSchema.optional(),
    freightMode: shippingModeSchema.optional(),
    leadTimeDays: defaultLeadTimeDaysSchema.optional(),
    parts: z.array(customerPartSchema).max(CUSTOMER_PARTS_MAX).default([]),
    lockVersion: z.number().int().nonnegative(),
  })
  .superRefine((value, ctx) => {
    const seen = new Set<string>();
    value.parts.forEach((part, index) => {
      const key = partKey(part.gradeId, part.rollWidthIn);
      if (seen.has(key)) {
        ctx.addIssue({
          code: 'custom',
          path: ['parts', index, 'rollWidthIn'],
          message: 'that paper and width is already a part on this account',
        });
      }
      seen.add(key);
    });
  });

export type PutCustomerDefaultsRequest = z.infer<typeof putCustomerDefaultsRequestSchema>;

export const setAgreedPriceRequestSchema = z.object({
  gradeId: partGradeIdSchema,
  rollWidthIn: rollWidthSchema,
  agreedPrice: z.object({ basis: pricingBasisSchema, price: agreedPriceFigureSchema }).nullable(),
  lockVersion: z.number().int().nonnegative(),
});

export type SetAgreedPriceRequest = z.infer<typeof setAgreedPriceRequestSchema>;

/** The defaults of a customer with none saved. A `lockVersion` of 0 means no row exists yet, which is why the schema allows 0. */
export function emptyCustomerDefaults(customerId: string): CustomerDefaults {
  return { customerId, parts: [], lockVersion: 0 };
}

export function partFor<Part extends Pick<CustomerPart, 'gradeId' | 'rollWidthIn'>>(
  parts: readonly Part[],
  gradeId: string,
  rollWidthIn: number,
): Part | undefined {
  const grade = gradeId.toLowerCase();
  return parts.find(
    (part) => part.gradeId.toLowerCase() === grade && part.rollWidthIn === rollWidthIn,
  );
}

function partKey(gradeId: string, rollWidthIn: number): string {
  return `${gradeId.toLowerCase()}|${String(rollWidthIn)}`;
}
