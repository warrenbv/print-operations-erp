// The order, its lines, conversion from a quote, and confirmation.
// The field-by-field mapping from a quote line is in apps/api/src/orders/orders.factory.ts.
// The state machine is enforced by modules/orders/src/order-state-machine.ts.
import { z } from 'zod';

import { revenueCategorySchema, taxJurisdictionSchema, taxStatusSchema } from './revenue';

import { measureSchema, moneySchema, toDecimal, withinColumn } from './decimal';
import { customerDescriptionSchema, customerPartNumberSchema } from './customer-part';
import { deliveryAddressSchema } from './delivery-address';
import { storedDocumentSchema } from './document';
import { freightInputSchema, freightResultSchema } from './freight';
import { paperCostBasisColumns } from './paper-cost-basis';
import { pricingBasisSchema } from './pricing-basis';
import { rollWidthSchema } from './roll-width';

// Mirrored by `orders_status_check` and the `order_transitions` checks in infra/db/migrations/orders/0000_baseline.sql.
export const ORDER_STATUSES = ['converted', 'confirmed'] as const;

export const orderStatusSchema = z.enum(ORDER_STATUSES);

export type OrderStatus = z.infer<typeof orderStatusSchema>;

/**
 * Conversion creates a converted order. Confirmation by Production or the Production Manager is the
 * only move, and it is final: docs/product/requirements.md (R11).
 */
export const ORDER_TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  converted: ['confirmed'],
  confirmed: [],
};

export const INITIAL_ORDER_STATUS: OrderStatus = 'converted';

export const orderIdSchema = z.string().min(1);

const jobNumber = z.string().trim().min(1).max(32);

const poNumber = z.string().trim().min(1).max(64);

export const orderSchema = z.object({
  id: orderIdSchema,

  quoteId: z.string().min(1),

  customerId: z.string().min(1),
  status: orderStatusSchema,

  jobNumber: jobNumber.optional(),

  confirmedLeadTimeDays: z.number().int().nonnegative().max(3650).optional(),

  confirmedBy: z.string().trim().min(1).max(128).optional(),
  confirmedAt: z.iso.datetime().optional(),

  salesRep: z.string().trim().max(128).optional(),

  poNumber: poNumber.optional(),

  poCapturedBy: z.string().trim().min(1).max(128).optional(),
  poCapturedAt: z.iso.datetime().optional(),

  requestedDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be a calendar date, YYYY-MM-DD')
    .optional(),

  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),

  lockVersion: z.number().int().positive().default(1),
});

export type Order = z.infer<typeof orderSchema>;

export const capturePurchaseOrderRequestSchema = z.object({
  lockVersion: z.coerce.number().int().positive(),
  poNumber: poNumber.optional(),

  // The API sets this from the session after reading the body: apps/api/src/orders/orders.controller.ts.
  capturedBy: z.string().trim().min(1).max(128),
});

export type CapturePurchaseOrderRequest = z.infer<typeof capturePurchaseOrderRequestSchema>;

// The largest PostgreSQL integer, the type of the quantity column.
const ROLL_COUNT_CEILING = 2_147_483_647;

export const requestedRollsSchema = z.number().int().positive().max(ROLL_COUNT_CEILING);

export const requestedPoundsSchema = withinColumn(
  measureSchema.refine((value) => toDecimal(value).gt(0), {
    error: 'enter the pounds ordered, more than 0',
  }),
  'measure',
  'pounds ordered',
);

export const createOrderLineSchema = z.object({
  quoteLineId: z.string().min(1),
  quantityRolls: requestedRollsSchema,
  orderedWeightLb: requestedPoundsSchema.optional(),
});

export type CreateOrderLine = z.infer<typeof createOrderLineSchema>;

const chosenLinesSchema = z
  .array(createOrderLineSchema)
  .min(1)
  .superRefine((lines, context) => {
    const seen = new Set<string>();
    for (const [index, line] of lines.entries()) {
      if (seen.has(line.quoteLineId)) {
        context.addIssue({
          code: 'custom',
          path: [index, 'quoteLineId'],
          message: 'each quote line may appear once',
        });
      }
      seen.add(line.quoteLineId);
    }
  });

const deliveryDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be a calendar date, YYYY-MM-DD');

// Carries no actor. The API records who converted from the session: docs/product/requirements.md (R10).
export const createOrderRequestSchema = z.object({
  quoteId: z.string().min(1),

  poNumber: poNumber.optional(),

  requestedDate: deliveryDateSchema.optional(),

  lines: chosenLinesSchema.optional(),
});

export type CreateOrderRequest = z.infer<typeof createOrderRequestSchema>;

export const CREATE_ORDERS_MAX_DELIVERIES = 100;

export const createOrderDeliverySchema = z.object({
  requestedDate: deliveryDateSchema,
  lines: chosenLinesSchema,
});

export type CreateOrderDelivery = z.infer<typeof createOrderDeliverySchema>;

// Several delivery dates on one PO. Each date becomes its own order: docs/decisions/README.md.
// A single delivery uses `createOrderRequestSchema`.
export const createOrdersRequestSchema = z.object({
  quoteId: z.string().min(1),
  poNumber: poNumber.optional(),
  deliveries: z
    .array(createOrderDeliverySchema)
    .min(2)
    .max(CREATE_ORDERS_MAX_DELIVERIES)
    .superRefine((deliveries, context) => {
      const seen = new Set<string>();
      for (const [index, delivery] of deliveries.entries()) {
        if (seen.has(delivery.requestedDate)) {
          context.addIssue({
            code: 'custom',
            path: [index, 'requestedDate'],
            message: 'each delivery date may appear once',
          });
        }
        seen.add(delivery.requestedDate);
      }
    }),
});

export type CreateOrdersRequest = z.infer<typeof createOrdersRequestSchema>;

// The committed lead time is a count of calendar days: docs/product/requirements.md (R11).
export const confirmOrderRequestSchema = z.object({
  lockVersion: z.number().int().positive(),
  confirmedLeadTimeDays: z.number().int().nonnegative().max(3650),
});

export type ConfirmOrderRequest = z.infer<typeof confirmOrderRequestSchema>;

export const orderTransitionSchema = z.object({
  id: z.string().min(1),
  orderId: orderIdSchema,
  from: orderStatusSchema.nullable(),
  to: orderStatusSchema,
  reason: z.string().max(500).optional(),

  actor: z.string().trim().min(1).max(128),
  at: z.iso.datetime(),
});

export type OrderTransition = z.infer<typeof orderTransitionSchema>;

export const orderTransitionListResponseSchema = z.object({
  items: z.array(orderTransitionSchema),
});

export type OrderTransitionListResponse = z.infer<typeof orderTransitionListResponseSchema>;

export const orderListResponseSchema = z.object({
  items: z.array(orderSchema),
});

export type OrderListResponse = z.infer<typeof orderListResponseSchema>;

/**
 * An order line keeps its own copy of the goods and the committed money, so a later revision of the
 * quote does not change it: docs/product/requirements.md (R9). `quoteLineId` is the route back to how
 * the price was reached: docs/decisions/002-what-crosses-a-module-boundary.md.
 */
export const orderLineSchema = z.object({
  id: z.string().min(1),
  orderId: orderIdSchema,

  lineNumber: z.number().int().positive(),

  quoteLineId: z.string().min(1).optional(),

  gradeId: z.string().min(1),
  footageVariant: z.string().trim().min(1).max(32),

  feetPerRoll: measureSchema.optional(),

  rollWidthIn: rollWidthSchema,

  customWidth: z.boolean().optional(),

  quantityRolls: z.number().int().positive(),

  orderedWeightLb: measureSchema.optional(),
  overwrap: z.boolean(),

  pallets: z.number().int().nonnegative().nullable(),

  pricingBasis: pricingBasisSchema,

  estimatedWeightLb: measureSchema,

  deliveryAddress: deliveryAddressSchema.optional(),

  revenueCategory: revenueCategorySchema,

  taxStatus: taxStatusSchema,
  taxJurisdiction: taxJurisdictionSchema.optional(),

  printed: z.boolean(),

  customerPartNumber: customerPartNumberSchema.optional(),

  customerDescription: customerDescriptionSchema.optional(),

  pricePerRoll: moneySchema,

  productPricePerLb: moneySchema.optional(),

  totalCostPerRoll: moneySchema,
  extendedPrice: moneySchema,
  extendedCost: moneySchema,
  extendedMargin: moneySchema,

  rollWeightLb: paperCostBasisColumns.rollWeightLb,
  paperCostPerLb: paperCostBasisColumns.paperCostPerLb,
  paperCostPerRoll: paperCostBasisColumns.paperCostPerRoll,

  freight: freightInputSchema,

  freightResult: freightResultSchema,

  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export type OrderLine = z.infer<typeof orderLineSchema>;

export const orderWithLinesSchema = orderSchema.extend({
  lines: z.array(orderLineSchema),
});

export type OrderWithLines = z.infer<typeof orderWithLinesSchema>;

export const orderTotalsSchema = z.object({
  extendedPrice: moneySchema,

  extendedCost: moneySchema,

  extendedMargin: moneySchema,

  estimatedWeightLb: measureSchema,

  freightCost: moneySchema,
  freightMargin: moneySchema,
  freightInvoiceTotal: moneySchema,

  freightPending: z.boolean(),
});

export type OrderTotals = z.infer<typeof orderTotalsSchema>;

export const ORDER_TOTALS_LOOKUP_MAX_IDS = 100;

export const orderTotalsLookupQuerySchema = z.object({
  ids: z
    .string()
    .transform((value) =>
      value
        .split(',')
        .map((part) => part.trim())
        .filter((part) => part !== ''),
    )
    .pipe(z.array(orderIdSchema).min(1).max(ORDER_TOTALS_LOOKUP_MAX_IDS)),
});

export type OrderTotalsLookupQuery = z.infer<typeof orderTotalsLookupQuerySchema>;

export const orderTotalsLookupResponseSchema = z.object({
  items: z.array(z.object({ orderId: orderIdSchema, totals: orderTotalsSchema })),
});

export type OrderTotalsLookupResponse = z.infer<typeof orderTotalsLookupResponseSchema>;

export const orderLinesLookupResponseSchema = z.object({
  items: z.array(z.object({ orderId: orderIdSchema, lines: z.array(orderLineSchema) })),
});

export type OrderLinesLookupResponse = z.infer<typeof orderLinesLookupResponseSchema>;

export const createOrdersResponseSchema = z.object({
  items: z.array(orderWithLinesSchema),
});

export type CreateOrdersResponse = z.infer<typeof createOrdersResponseSchema>;

export const confirmationIssuedResponseSchema = z.object({
  document: storedDocumentSchema,
  recipients: z.array(z.string().min(1)),
  messageId: z.string().min(1),
  issuedAt: z.iso.datetime(),

  redirectedTo: z.array(z.string().min(1)).optional(),
});

export type ConfirmationIssuedResponse = z.infer<typeof confirmationIssuedResponseSchema>;
