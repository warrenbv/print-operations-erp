// The quoting schema. drizzle-kit generates the first part of
// infra/db/migrations/quoting/0000_baseline.sql from this file. The CHECK constraints and partial
// unique indexes are written by hand in that migration. Money and rates are `numeric` read as
// strings: docs/decisions/010-orm-spike.md and docs/decisions/003-decimal-arithmetic.md.
import { relations, sql } from 'drizzle-orm';
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

export const quotingSchema = pgSchema('quoting');

// Roll width is read as a number, unlike money. It is held to sixteenths of an inch by a CHECK in
// the baseline migration, and sixteenths are exact in binary floating point.
function rollWidthColumn() {
  return numeric('roll_width_in', { precision: 8, scale: 4, mode: 'number' });
}

export const quoteNumberSeq = quotingSchema.sequence('quote_number_seq', { startWith: 1 });

export const grades = quotingSchema.table(
  'grades',
  {
    id: uuid('id').primaryKey(),

    productFamily: text('product_family').notNull(),
    code: text('code').notNull(),

    basisWeightLb: numeric('basis_weight_lb', {
      precision: 12,
      scale: 4,
      mode: 'string',
    }).notNull(),

    reamAreaDivisor: numeric('ream_area_divisor', {
      precision: 12,
      scale: 4,
      mode: 'string',
    }).notNull(),

    paperCostPerTonne: numeric('paper_cost_per_tonne', {
      precision: 19,
      scale: 4,
      mode: 'string',
    }).notNull(),

    lockVersion: integer('lock_version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('grades_family_code_unique').on(table.productFamily, table.code),
    index('grades_product_family_idx').on(table.productFamily),
  ],
);

export const gradeFootages = quotingSchema.table(
  'grade_footages',
  {
    id: uuid('id').primaryKey(),

    gradeId: uuid('grade_id')
      .notNull()
      .references(() => grades.id, { onDelete: 'cascade' }),

    variant: text('variant').notNull(),
    label: text('label').notNull(),
    feetPerRoll: numeric('feet_per_roll', { precision: 12, scale: 4, mode: 'string' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('grade_footages_grade_variant_unique').on(table.gradeId, table.variant),
    index('grade_footages_grade_id_idx').on(table.gradeId),
  ],
);

export const gradeWidths = quotingSchema.table(
  'grade_widths',
  {
    id: uuid('id').primaryKey(),
    gradeId: uuid('grade_id')
      .notNull()
      .references(() => grades.id, { onDelete: 'cascade' }),
    rollWidthIn: rollWidthColumn().notNull(),
    rollsPerPallet: integer('rolls_per_pallet'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('grade_widths_grade_width_unique').on(table.gradeId, table.rollWidthIn),
    index('grade_widths_grade_id_idx').on(table.gradeId),
  ],
);

export const pricingConfig = quotingSchema.table(
  'pricing_config',
  {
    id: uuid('id').primaryKey(),
    // One configuration row only: a unique index on this column, which a CHECK pins to true.
    isSingleton: boolean('is_singleton').notNull().default(true),

    poundsPerTonne: numeric('pounds_per_tonne', {
      precision: 12,
      scale: 8,
      mode: 'string',
    }).notNull(),
    wastePct: numeric('waste_pct', { precision: 9, scale: 6, mode: 'string' }).notNull(),

    coreCostPerCore: numeric('core_cost_per_core', {
      precision: 19,
      scale: 4,
      mode: 'string',
    }).notNull(),

    coreReferenceLengthIn: numeric('core_reference_length_in', {
      precision: 12,
      scale: 4,
      mode: 'string',
    }).notNull(),

    plugCostPerPlug: numeric('plug_cost_per_plug', {
      precision: 12,
      scale: 8,
      mode: 'string',
    }).notNull(),
    plugsPerRoll: integer('plugs_per_roll').notNull(),

    palletCost: numeric('pallet_cost', { precision: 19, scale: 4, mode: 'string' }).notNull(),

    marginFloorPct: numeric('margin_floor_pct', {
      precision: 9,
      scale: 6,
      mode: 'string',
    }).notNull(),

    overwrapSurchargePct: numeric('overwrap_surcharge_pct', {
      precision: 9,
      scale: 6,
      mode: 'string',
    }).notNull(),

    ourVehicleFreightRate: numeric('our_vehicle_freight_rate', {
      precision: 19,
      scale: 4,
      mode: 'string',
    }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),

    updatedBy: text('updated_by'),
  },
  (table) => [uniqueIndex('pricing_config_singleton_unique').on(table.isSingleton)],
);

export const pricingConfigChanges = quotingSchema.table(
  'pricing_config_changes',
  {
    id: uuid('id').primaryKey(),

    actor: text('actor').notNull(),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
    previousPoundsPerTonne: numeric('previous_pounds_per_tonne', {
      precision: 12,
      scale: 8,
      mode: 'string',
    }).notNull(),
    previousWastePct: numeric('previous_waste_pct', {
      precision: 9,
      scale: 6,
      mode: 'string',
    }).notNull(),
    previousCoreCostPerCore: numeric('previous_core_cost_per_core', {
      precision: 19,
      scale: 4,
      mode: 'string',
    }).notNull(),
    previousCoreReferenceLengthIn: numeric('previous_core_reference_length_in', {
      precision: 12,
      scale: 4,
      mode: 'string',
    }).notNull(),
    previousPlugCostPerPlug: numeric('previous_plug_cost_per_plug', {
      precision: 12,
      scale: 8,
      mode: 'string',
    }).notNull(),
    previousPlugsPerRoll: integer('previous_plugs_per_roll').notNull(),
    previousPalletCost: numeric('previous_pallet_cost', {
      precision: 19,
      scale: 4,
      mode: 'string',
    }).notNull(),
    previousMarginFloorPct: numeric('previous_margin_floor_pct', {
      precision: 9,
      scale: 6,
      mode: 'string',
    }).notNull(),
    previousOverwrapSurchargePct: numeric('previous_overwrap_surcharge_pct', {
      precision: 9,
      scale: 6,
      mode: 'string',
    }).notNull(),
    previousOurVehicleFreightRate: numeric('previous_our_vehicle_freight_rate', {
      precision: 19,
      scale: 4,
      mode: 'string',
    }).notNull(),
  },

  (table) => [index('pricing_config_changes_at_idx').on(table.at)],
);

export const palletFits = quotingSchema.table(
  'pallet_fits',
  {
    id: uuid('id').primaryKey(),
    productFamily: text('product_family').notNull(),
    rollWidthIn: rollWidthColumn().notNull(),
    rollsPerPallet: integer('rolls_per_pallet').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('pallet_fits_family_width_unique').on(table.productFamily, table.rollWidthIn),
    index('pallet_fits_family_width_idx').on(table.productFamily, table.rollWidthIn),
  ],
);

export const quotes = quotingSchema.table(
  'quotes',
  {
    id: uuid('id').primaryKey(),

    // No foreign key. Customers belong to the CRM module: docs/decisions/001-modular-monorepo.md.
    customerId: uuid('customer_id').notNull(),

    status: text('status').notNull(),

    rootQuoteId: uuid('root_quote_id').notNull(),

    versionNumber: integer('version_number').notNull().default(1),

    // Every version in a chain keeps the chain's quote number. The number and version together are
    // unique.
    quoteNumber: integer('quote_number')
      .notNull()
      .default(sql`nextval('quoting.quote_number_seq')`),

    // Bumped by every write to the quote or its lines:
    // docs/decisions/006-optimistic-concurrency.md.
    lockVersion: integer('lock_version').notNull().default(1),

    salesRep: text('sales_rep'),

    leadTimeDays: integer('lead_time_days'),

    leadTimeSetBy: text('lead_time_set_by'),
    leadTimeSetAt: timestamp('lead_time_set_at', { withTimezone: true }),
    notes: text('notes'),

    freightInRollPrice: boolean('freight_in_roll_price').notNull().default(false),

    // The live price approval and the live floor override. Each pair is set or cleared together,
    // and every decision is also logged in quote_override_decisions.
    overrideApprovedBy: text('override_approved_by'),
    overrideApprovedAt: timestamp('override_approved_at', { withTimezone: true }),

    floorOverrideBy: text('floor_override_by'),
    floorOverrideAt: timestamp('floor_override_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('quotes_customer_id_idx').on(table.customerId),

    uniqueIndex('quotes_root_version_unique').on(table.rootQuoteId, table.versionNumber),

    uniqueIndex('quotes_number_version_unique').on(table.quoteNumber, table.versionNumber),

    index('quotes_root_quote_id_idx').on(table.rootQuoteId, table.versionNumber),
    index('quotes_status_idx').on(table.status),

    index('quotes_status_created_at_idx').on(table.status, table.createdAt),
  ],
);

export const taxRates = quotingSchema.table(
  'tax_rates',
  {
    id: uuid('id').primaryKey(),

    jurisdiction: text('jurisdiction').notNull(),

    rate: numeric('rate', { precision: 9, scale: 6, mode: 'string' }).notNull(),

    effectiveFrom: date('effective_from').notNull(),

    source: text('source').notNull(),

    name: text('name'),

    stateRate: numeric('state_rate', { precision: 9, scale: 6, mode: 'string' }),
    localRate: numeric('local_rate', { precision: 9, scale: 6, mode: 'string' }),
    rtaRate: numeric('rta_rate', { precision: 9, scale: 6, mode: 'string' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('tax_rates_jurisdiction_effective_unique').on(
      table.jurisdiction,
      table.effectiveFrom,
    ),

    index('tax_rates_jurisdiction_effective_idx').on(table.jurisdiction, table.effectiveFrom),
  ],
);

// A line stores its whole price build-up as calculated when it was saved, so later changes to
// grades, tiers or configuration do not move a saved price. Orders copy the committed figures and
// keep the line id as the route back to this build-up:
// docs/decisions/002-what-crosses-a-module-boundary.md.
export const quoteLines = quotingSchema.table(
  'quote_lines',
  {
    id: uuid('id').primaryKey(),

    quoteId: uuid('quote_id')
      .notNull()
      .references(() => quotes.id, { onDelete: 'cascade' }),

    lineNumber: integer('line_number').notNull(),

    gradeId: uuid('grade_id')
      .notNull()
      // A grade used on any quote line cannot be deleted.
      .references(() => grades.id, { onDelete: 'restrict' }),
    footageVariant: text('footage_variant').notNull(),
    rollWidthIn: rollWidthColumn().notNull(),

    customWidth: boolean('custom_width').notNull().default(false),

    quantityRolls: integer('quantity_rolls').notNull(),
    overwrap: boolean('overwrap').notNull().default(false),

    pricingBasis: text('pricing_basis').notNull().default('per_roll'),

    orderedWeightLb: numeric('ordered_weight_lb', {
      precision: 12,
      scale: 4,
      mode: 'string',
    }),

    feetPerRollOverride: numeric('feet_per_roll_override', {
      precision: 12,
      scale: 4,
      mode: 'string',
    }),
    convertCostPerTon: numeric('convert_cost_per_ton', {
      precision: 19,
      scale: 4,
      mode: 'string',
    }),
    printCostPerTon: numeric('print_cost_per_ton', {
      precision: 19,
      scale: 4,
      mode: 'string',
    }),

    tierOverrideCode: text('tier_override_code'),

    overridePricePerRoll: numeric('override_price_per_roll', {
      precision: 19,
      scale: 4,
      mode: 'string',
    }),

    overridePricePerLb: numeric('override_price_per_lb', {
      precision: 19,
      scale: 4,
      mode: 'string',
    }),

    marginOverridePct: numeric('margin_override_pct', { precision: 9, scale: 6, mode: 'string' }),

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
    freightMargin: numeric('freight_margin', {
      precision: 19,
      scale: 4,
      mode: 'string',
    }).notNull(),
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

    revenueCategory: text('revenue_category').notNull(),

    taxStatus: text('tax_status').notNull(),

    taxJurisdiction: text('tax_jurisdiction'),

    printed: boolean('printed').notNull(),

    customerPartNumber: text('customer_part_number'),
    customerDescription: text('customer_description'),

    rollWeightLb: numeric('roll_weight_lb', { precision: 12, scale: 4, mode: 'string' }).notNull(),

    paperCostPerLb: numeric('paper_cost_per_lb', {
      precision: 19,
      scale: 8,
      mode: 'string',
    }).notNull(),
    paperCostPerRoll: numeric('paper_cost_per_roll', {
      precision: 19,
      scale: 4,
      mode: 'string',
    }).notNull(),
    hardwareCostPerRoll: numeric('hardware_cost_per_roll', {
      precision: 19,
      scale: 4,
      mode: 'string',
    }).notNull(),
    addOnCostPerRoll: numeric('add_on_cost_per_roll', {
      precision: 19,
      scale: 4,
      mode: 'string',
    }).notNull(),
    totalCostPerRoll: numeric('total_cost_per_roll', {
      precision: 19,
      scale: 4,
      mode: 'string',
    }).notNull(),

    rollsPerPallet: integer('rolls_per_pallet'),

    feetPerRoll: numeric('feet_per_roll', { precision: 12, scale: 4, mode: 'string' }).notNull(),

    // A snapshot of the tier at pricing time, with no foreign key, so a later tier edit leaves it
    // alone.
    tierId: uuid('tier_id').notNull(),
    tierCode: text('tier_code').notNull(),
    tierName: text('tier_name').notNull(),
    tierMarginPct: numeric('tier_margin_pct', {
      precision: 9,
      scale: 6,
      mode: 'string',
    }).notNull(),

    tierSource: text('tier_source').notNull(),

    pallets: integer('pallets'),

    priceSource: text('price_source').notNull().default('tier'),
    basePricePerRoll: numeric('base_price_per_roll', {
      precision: 19,
      scale: 4,
      mode: 'string',
    }).notNull(),

    marginPricePerRoll: numeric('margin_price_per_roll', {
      precision: 19,
      scale: 4,
      mode: 'string',
    }),
    pricePerRoll: numeric('price_per_roll', { precision: 19, scale: 4, mode: 'string' }).notNull(),
    deliveredPricePerRoll: numeric('delivered_price_per_roll', {
      precision: 19,
      scale: 4,
      mode: 'string',
    }).notNull(),
    marginPct: numeric('margin_pct', { precision: 9, scale: 6, mode: 'string' }).notNull(),

    floorStatus: text('floor_status').notNull(),

    floorPct: numeric('floor_pct', { precision: 9, scale: 6, mode: 'string' }),
    floorMinimumPricePerRoll: numeric('floor_minimum_price_per_roll', {
      precision: 19,
      scale: 4,
      mode: 'string',
    }),
    extendedPrice: numeric('extended_price', { precision: 19, scale: 4, mode: 'string' }).notNull(),
    extendedCost: numeric('extended_cost', { precision: 19, scale: 4, mode: 'string' }).notNull(),
    extendedMargin: numeric('extended_margin', {
      precision: 19,
      scale: 4,
      mode: 'string',
    }).notNull(),
    estimatedWeightLb: numeric('estimated_weight_lb', {
      precision: 12,
      scale: 4,
      mode: 'string',
    }).notNull(),

    pricePerLb: numeric('price_per_lb', { precision: 19, scale: 4, mode: 'string' }).notNull(),
    effectivePricePerLb: numeric('effective_price_per_lb', {
      precision: 19,
      scale: 4,
      mode: 'string',
    }).notNull(),

    basePricePerLb: numeric('base_price_per_lb', {
      precision: 19,
      scale: 4,
      mode: 'string',
    }),

    productPricePerLb: numeric('product_price_per_lb', {
      precision: 19,
      scale: 4,
      mode: 'string',
    }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('quote_lines_quote_line_number_unique').on(table.quoteId, table.lineNumber),
    index('quote_lines_quote_id_idx').on(table.quoteId),
    index('quote_lines_grade_id_idx').on(table.gradeId),

    index('quote_lines_floor_status_idx').on(table.floorStatus),

    index('quote_lines_price_source_idx').on(table.priceSource),

    index('quote_lines_freight_pending_idx').on(table.freightPending),
  ],
);

export const quoteOverrideDecisions = quotingSchema.table(
  'quote_override_decisions',
  {
    id: uuid('id').primaryKey(),
    quoteId: uuid('quote_id')
      .notNull()
      .references(() => quotes.id, { onDelete: 'cascade' }),

    decision: text('decision').notNull(),

    kind: text('kind').notNull(),

    actor: text('actor').notNull(),
    reason: text('reason'),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('quote_override_decisions_quote_id_idx').on(table.quoteId, table.at)],
);

export const quoteOverrideDecisionsRelations = relations(quoteOverrideDecisions, ({ one }) => ({
  quote: one(quotes, { fields: [quoteOverrideDecisions.quoteId], references: [quotes.id] }),
}));

export const quoteSends = quotingSchema.table(
  'quote_sends',
  {
    id: uuid('id').primaryKey(),
    quoteId: uuid('quote_id')
      .notNull()
      .references(() => quotes.id, { onDelete: 'cascade' }),

    messageId: text('message_id').notNull(),

    actor: text('actor').notNull(),

    acceptedByRelayAt: timestamp('accepted_by_relay_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index('quote_sends_quote_id_idx').on(table.quoteId, table.acceptedByRelayAt)],
);

export const quoteSendsRelations = relations(quoteSends, ({ one }) => ({
  quote: one(quotes, { fields: [quoteSends.quoteId], references: [quotes.id] }),
}));

export const gradesRelations = relations(grades, ({ many }) => ({
  footages: many(gradeFootages),
  widths: many(gradeWidths),
}));

export const quotesRelations = relations(quotes, ({ many }) => ({
  lines: many(quoteLines),
}));

export const quoteLinesRelations = relations(quoteLines, ({ one }) => ({
  quote: one(quotes, { fields: [quoteLines.quoteId], references: [quotes.id] }),
  grade: one(grades, { fields: [quoteLines.gradeId], references: [grades.id] }),
}));

export const gradeFootagesRelations = relations(gradeFootages, ({ one }) => ({
  grade: one(grades, { fields: [gradeFootages.gradeId], references: [grades.id] }),
}));

export const gradeWidthsRelations = relations(gradeWidths, ({ one }) => ({
  grade: one(grades, { fields: [gradeWidths.gradeId], references: [grades.id] }),
}));

export const pricingTiers = quotingSchema.table(
  'pricing_tiers',
  {
    id: uuid('id').primaryKey(),

    code: text('code').notNull(),
    name: text('name').notNull(),

    marginPct: numeric('margin_pct', { precision: 9, scale: 6, mode: 'string' }).notNull(),

    minPallets: integer('min_pallets').notNull(),

    // At most one list tier, held by a partial unique index in the baseline migration.
    isListTier: boolean('is_list_tier').notNull().default(false),

    updatedBy: text('updated_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('pricing_tiers_code_unique').on(table.code),

    uniqueIndex('pricing_tiers_min_pallets_unique').on(table.minPallets),
    index('pricing_tiers_min_pallets_idx').on(table.minPallets),
  ],
);

export const pricingTierChanges = quotingSchema.table(
  'pricing_tier_changes',
  {
    id: uuid('id').primaryKey(),

    tierCode: text('tier_code').notNull(),

    actor: text('actor').notNull(),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
    previousName: text('previous_name').notNull(),
    previousMarginPct: numeric('previous_margin_pct', {
      precision: 9,
      scale: 6,
      mode: 'string',
    }).notNull(),
    previousMinPallets: integer('previous_min_pallets').notNull(),
  },

  (table) => [
    index('pricing_tier_changes_at_idx').on(table.at),
    index('pricing_tier_changes_tier_code_idx').on(table.tierCode),
  ],
);

// Credit-hold exceptions: docs/product/requirements.md (R2). `spent_by_quote_id` records the one
// quote an approved exception was used for.
export const quoteApprovals = quotingSchema.table(
  'quote_approvals',
  {
    id: uuid('id').primaryKey(),

    customerId: uuid('customer_id').notNull(),

    status: text('status').notNull(),

    reason: text('reason').notNull(),

    requestedBy: text('requested_by').notNull(),
    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
    decidedBy: text('decided_by'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),

    decisionReason: text('decision_reason'),

    spentByQuoteId: uuid('spent_by_quote_id').references(() => quotes.id),
    spentAt: timestamp('spent_at', { withTimezone: true }),
  },
  (table) => [
    index('quote_approvals_status_requested_at_idx').on(table.status, table.requestedAt),

    index('quote_approvals_customer_id_idx').on(table.customerId, table.status),
  ],
);

export const quoteApprovalsRelations = relations(quoteApprovals, ({ one }) => ({
  spentByQuote: one(quotes, {
    fields: [quoteApprovals.spentByQuoteId],
    references: [quotes.id],
  }),
}));
