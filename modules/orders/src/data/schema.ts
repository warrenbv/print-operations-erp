// The orders tables in Drizzle: orders, their lines and their status history. The generated part of
// infra/db/migrations/orders/0000_baseline.sql comes from this file. The CHECK constraints and the
// job number sequence are hand-written in that migration and do not appear here.
// Money is numeric(19,4) read as a string: docs/decisions/003-decimal-arithmetic.md.
import {
  boolean,
  date,
  index,
  integer,
  numeric,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

export const ordersSchema = pgSchema('orders');

export const orders = ordersSchema.table(
  'orders',
  {
    id: uuid('id').primaryKey(),

    // Ids owned by quoting and crm. No foreign key crosses a module's schema:
    // docs/decisions/001-modular-monorepo.md.
    quoteId: uuid('quote_id').notNull(),

    customerId: uuid('customer_id').notNull(),

    status: text('status').notNull(),

    // Null until confirmation, then set together with the lead time, confirmer and time.
    // orders_confirmation_record_check in the baseline holds that: docs/product/requirements.md (R11).
    jobNumber: text('job_number'),

    confirmedLeadTimeDays: integer('confirmed_lead_time_days'),

    confirmedBy: text('confirmed_by'),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),

    salesRep: text('sales_rep'),

    // The customer's PO, stored with who recorded it and when: docs/product/requirements.md (R9).
    poNumber: text('po_number'),

    poCapturedBy: text('po_captured_by'),
    poCapturedAt: timestamp('po_captured_at', { withTimezone: true }),

    requestedDate: date('requested_date'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),

    lockVersion: integer('lock_version').notNull().default(1),
  },
  (table) => [
    index('orders_quote_id_idx').on(table.quoteId),

    uniqueIndex('orders_job_number_unique').on(table.jobNumber),
    index('orders_status_idx').on(table.status),
    index('orders_customer_id_idx').on(table.customerId),
  ],
);

export const orderTransitions = ordersSchema.table(
  'order_transitions',
  {
    id: uuid('id').primaryKey(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),

    fromStatus: text('from_status'),
    toStatus: text('to_status').notNull(),
    reason: text('reason'),

    actor: text('actor').notNull(),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('order_transitions_order_id_idx').on(table.orderId, table.at)],
);

export const orderLines = ordersSchema.table(
  'order_lines',
  {
    id: uuid('id').primaryKey(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),

    lineNumber: integer('line_number').notNull(),

    // The route back to how this line was priced in quoting:
    // docs/decisions/002-what-crosses-a-module-boundary.md.
    quoteLineId: uuid('quote_line_id'),

    gradeId: uuid('grade_id').notNull(),
    footageVariant: text('footage_variant').notNull(),

    feetPerRoll: numeric('feet_per_roll', { precision: 12, scale: 4, mode: 'string' }),

    // Read as a number, not a string. The baseline holds it to sixteenths of an inch, which binary
    // floating point represents exactly.
    rollWidthIn: numeric('roll_width_in', { precision: 8, scale: 4, mode: 'number' }).notNull(),

    customWidth: boolean('custom_width').notNull().default(false),
    quantityRolls: integer('quantity_rolls').notNull(),
    overwrap: boolean('overwrap').notNull(),

    pallets: integer('pallets'),

    revenueCategory: text('revenue_category').notNull(),

    taxStatus: text('tax_status').notNull(),
    taxJurisdiction: text('tax_jurisdiction'),

    printed: boolean('printed').notNull(),

    customerPartNumber: text('customer_part_number'),
    customerDescription: text('customer_description'),

    estimatedWeightLb: numeric('estimated_weight_lb', {
      precision: 12,
      scale: 4,
      mode: 'string',
    }).notNull(),

    pricingBasis: text('pricing_basis').notNull().default('per_roll'),

    orderedWeightLb: numeric('ordered_weight_lb', {
      precision: 12,
      scale: 4,
      mode: 'string',
    }),

    // The committed money, copied from the quote line at conversion. A later revision of the quote
    // does not change it: docs/product/requirements.md (R9).
    pricePerRoll: numeric('price_per_roll', { precision: 19, scale: 4, mode: 'string' }).notNull(),

    productPricePerLb: numeric('product_price_per_lb', {
      precision: 19,
      scale: 4,
      mode: 'string',
    }),

    totalCostPerRoll: numeric('total_cost_per_roll', {
      precision: 19,
      scale: 4,
      mode: 'string',
    }).notNull(),
    extendedPrice: numeric('extended_price', { precision: 19, scale: 4, mode: 'string' }).notNull(),
    extendedCost: numeric('extended_cost', { precision: 19, scale: 4, mode: 'string' }).notNull(),
    extendedMargin: numeric('extended_margin', {
      precision: 19,
      scale: 4,
      mode: 'string',
    }).notNull(),

    rollWeightLb: numeric('roll_weight_lb', { precision: 12, scale: 4, mode: 'string' }),

    paperCostPerLb: numeric('paper_cost_per_lb', { precision: 19, scale: 8, mode: 'string' }),

    paperCostPerRoll: numeric('paper_cost_per_roll', { precision: 19, scale: 4, mode: 'string' }),

    freightMode: text('freight_mode').notNull(),
    freightRateOverride: numeric('freight_rate_override', {
      precision: 19,
      scale: 4,
      mode: 'string',
    }),
    freightCarrierBid: numeric('freight_carrier_bid', {
      precision: 19,
      scale: 4,
      mode: 'string',
    }),
    freightMarginPct: numeric('freight_margin_pct', { precision: 9, scale: 6, mode: 'string' }),

    freightCost: numeric('freight_cost', { precision: 19, scale: 4, mode: 'string' }).notNull(),
    freightMargin: numeric('freight_margin', { precision: 19, scale: 4, mode: 'string' }).notNull(),
    freightInvoiceTotal: numeric('freight_invoice_total', {
      precision: 19,
      scale: 4,
      mode: 'string',
    }).notNull(),

    freightPending: boolean('freight_pending').notNull().default(false),

    deliveryName: text('delivery_name'),
    deliveryLine1: text('delivery_line1'),
    deliveryLine2: text('delivery_line2'),
    deliveryCity: text('delivery_city'),
    deliveryState: text('delivery_state'),
    deliveryPostalCode: text('delivery_postal_code'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('order_lines_order_id_idx').on(table.orderId, table.lineNumber),

    uniqueIndex('order_lines_quote_line_id_order_id_unique').on(table.quoteLineId, table.orderId),
  ],
);

export const ordersRelations = relations(orders, ({ many }) => ({
  transitions: many(orderTransitions),
  lines: many(orderLines),
}));

export const orderTransitionsRelations = relations(orderTransitions, ({ one }) => ({
  order: one(orders, { fields: [orderTransitions.orderId], references: [orders.id] }),
}));

export const orderLinesRelations = relations(orderLines, ({ one }) => ({
  order: one(orders, { fields: [orderLines.orderId], references: [orders.id] }),
}));
