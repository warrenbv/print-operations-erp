// The crm tables in Drizzle. The generated part of infra/db/migrations/crm/0000_baseline.sql comes
// from this file. The CHECK constraints are hand-written in that migration and do not appear here.
// Decimals are numeric columns read as strings: docs/decisions/003-decimal-arithmetic.md.
import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  foreignKey,
  index,
  integer,
  numeric,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const crmSchema = pgSchema('crm');

export const customers = crmSchema.table(
  'customers',
  {
    id: uuid('id').primaryKey(),
    name: text('name').notNull(),

    legacyAccountNumber: text('legacy_account_number'),

    legacyUmbrellaAccountNumber: text('legacy_umbrella_account_number'),

    paymentTermsKind: text('payment_terms_kind').notNull().default('net'),
    netDays: integer('net_days').notNull().default(15),

    taxJurisdiction: text('tax_jurisdiction'),
    taxExempt: boolean('tax_exempt').notNull().default(false),

    taxExemptionDocRef: text('tax_exemption_doc_ref'),
    reseller: boolean('reseller').notNull().default(false),

    billingName: text('billing_name'),
    billingLine1: text('billing_line1'),
    billingLine2: text('billing_line2'),
    billingCity: text('billing_city'),

    billingState: text('billing_state'),

    billingPostalCode: text('billing_postal_code'),

    shippingName: text('shipping_name'),
    shippingLine1: text('shipping_line1'),
    shippingLine2: text('shipping_line2'),
    shippingCity: text('shipping_city'),

    shippingState: text('shipping_state'),

    shippingPostalCode: text('shipping_postal_code'),

    freightMarginPct: numeric('freight_margin_pct', {
      precision: 9,
      scale: 6,
      mode: 'string',
    }),

    accountRepUsername: text('account_rep_username'),

    // Quoting reads the hold through `CustomerService.mayQuote` when a quote is created:
    // docs/product/requirements.md (R2).
    creditHold: boolean('credit_hold').notNull().default(false),

    creditHoldSetBy: text('credit_hold_set_by'),
    creditHoldSetAt: timestamp('credit_hold_set_at', { withTimezone: true }),

    // Checked and moved by every write: docs/decisions/006-optimistic-concurrency.md.
    lockVersion: integer('lock_version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('customers_legacy_account_number_unique').on(table.legacyAccountNumber),

    index('customers_name_idx').on(table.name),
  ],
);

export const contacts = crmSchema.table(
  'contacts',
  {
    id: uuid('id').primaryKey(),

    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),

    name: text('name'),
    email: text('email'),

    phone: text('phone'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),

    lockVersion: integer('lock_version').notNull().default(1),

    // Derived by the database. contact_roles copies it through a composite foreign key that
    // cascades on update, so a contact cannot lose the address a role needs while holding the role.
    contactReach: text('contact_reach').generatedAlwaysAs(
      sql`CASE WHEN "email" IS NOT NULL AND "phone" IS NOT NULL THEN 'both' WHEN "email" IS NOT NULL THEN 'email' WHEN "phone" IS NOT NULL THEN 'phone' ELSE 'none' END`,
    ),
  },
  (table) => [
    index('contacts_customer_id_idx').on(table.customerId),

    unique('contacts_id_reach_key').on(table.id, table.contactReach),
  ],
);

export const contactRoles = crmSchema.table(
  'contact_roles',
  {
    contactId: uuid('contact_id')
      .notNull()
      .references(() => contacts.id, { onDelete: 'cascade' }),

    role: text('role').notNull(),

    contactReach: text('contact_reach').notNull(),

    setBy: text('set_by').notNull(),
    setAt: timestamp('set_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.contactId, table.role] }),

    index('contact_roles_role_idx').on(table.role, table.contactId),

    foreignKey({
      name: 'contact_roles_reach_fkey',
      columns: [table.contactId, table.contactReach],
      foreignColumns: [contacts.id, contacts.contactReach],
    }).onUpdate('cascade'),
  ],
);

export const customerDefaults = crmSchema.table('customer_defaults', {
  customerId: uuid('customer_id')
    .primaryKey()
    .references(() => customers.id, { onDelete: 'cascade' }),

  pricingBasis: text('pricing_basis'),

  tierCode: text('tier_code'),

  freightMode: text('freight_mode'),

  leadTimeDays: integer('lead_time_days'),

  lockVersion: integer('lock_version').notNull().default(1),

  updatedBy: text('updated_by').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
});

export const customerParts = crmSchema.table(
  'customer_parts',
  {
    id: uuid('id').primaryKey(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customerDefaults.customerId, { onDelete: 'cascade' }),

    position: integer('position').notNull(),
    gradeId: uuid('grade_id').notNull(),

    // Read as a number, not a string. The baseline holds it to sixteenths of an inch, which binary
    // floating point represents exactly, so lookups by grade and width can compare it with ===.
    rollWidthIn: numeric('roll_width_in', { precision: 8, scale: 4, mode: 'number' }).notNull(),
    partNumber: text('part_number'),
    description: text('description'),

    feetPerRoll: numeric('feet_per_roll', { precision: 12, scale: 4, mode: 'string' }),

    agreedPriceBasis: text('agreed_price_basis'),
    agreedPrice: numeric('agreed_price', { precision: 19, scale: 4, mode: 'string' }),
    agreedPriceSetBy: text('agreed_price_set_by'),
    agreedPriceSetAt: timestamp('agreed_price_set_at', { withTimezone: true }),
  },
  (table) => [
    unique('customer_parts_customer_grade_width_key').on(
      table.customerId,
      table.gradeId,
      table.rollWidthIn,
    ),
  ],
);

export const customersRelations = relations(customers, ({ many, one }) => ({
  contacts: many(contacts),
  defaults: one(customerDefaults),
}));

export const customerDefaultsRelations = relations(customerDefaults, ({ one, many }) => ({
  customer: one(customers, {
    fields: [customerDefaults.customerId],
    references: [customers.id],
  }),
  parts: many(customerParts),
}));

export const customerPartsRelations = relations(customerParts, ({ one }) => ({
  defaults: one(customerDefaults, {
    fields: [customerParts.customerId],
    references: [customerDefaults.customerId],
  }),
}));

export const contactsRelations = relations(contacts, ({ one, many }) => ({
  customer: one(customers, { fields: [contacts.customerId], references: [customers.id] }),
  roles: many(contactRoles),
}));

export const contactRolesRelations = relations(contactRoles, ({ one }) => ({
  contact: one(contacts, { fields: [contactRoles.contactId], references: [contacts.id] }),
}));
