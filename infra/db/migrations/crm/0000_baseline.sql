-- Baseline of the crm schema, owned by modules/crm (modules/crm/README.md).
-- Two parts: the schema drizzle-kit generates from modules/crm/src/data/schema.ts, then CHECK
-- constraints written by hand. There are no reference rows.
--
-- Part 1: generated from modules/crm/src/data/schema.ts.
CREATE SCHEMA "crm";
--> statement-breakpoint
CREATE TABLE "crm"."contact_roles" (
	"contact_id" uuid NOT NULL,
	"role" text NOT NULL,
	"contact_reach" text NOT NULL,
	"set_by" text NOT NULL,
	"set_at" timestamp with time zone NOT NULL,
	CONSTRAINT "contact_roles_contact_id_role_pk" PRIMARY KEY("contact_id","role")
);
--> statement-breakpoint
CREATE TABLE "crm"."contacts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"customer_id" uuid NOT NULL,
	"name" text,
	"email" text,
	"phone" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lock_version" integer DEFAULT 1 NOT NULL,
	"contact_reach" text GENERATED ALWAYS AS (CASE WHEN "email" IS NOT NULL AND "phone" IS NOT NULL THEN 'both' WHEN "email" IS NOT NULL THEN 'email' WHEN "phone" IS NOT NULL THEN 'phone' ELSE 'none' END) STORED,
	CONSTRAINT "contacts_id_reach_key" UNIQUE("id","contact_reach")
);
--> statement-breakpoint
CREATE TABLE "crm"."customer_defaults" (
	"customer_id" uuid PRIMARY KEY NOT NULL,
	"pricing_basis" text,
	"tier_code" text,
	"freight_mode" text,
	"lead_time_days" integer,
	"lock_version" integer DEFAULT 1 NOT NULL,
	"updated_by" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm"."customer_parts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"customer_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"grade_id" uuid NOT NULL,
	"roll_width_in" numeric(8, 4) NOT NULL,
	"part_number" text,
	"description" text,
	"feet_per_roll" numeric(12, 4),
	"agreed_price_basis" text,
	"agreed_price" numeric(19, 4),
	"agreed_price_set_by" text,
	"agreed_price_set_at" timestamp with time zone,
	CONSTRAINT "customer_parts_customer_grade_width_key" UNIQUE("customer_id","grade_id","roll_width_in")
);
--> statement-breakpoint
CREATE TABLE "crm"."customers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"legacy_account_number" text,
	"legacy_umbrella_account_number" text,
	"payment_terms_kind" text DEFAULT 'net' NOT NULL,
	"net_days" integer DEFAULT 15 NOT NULL,
	"tax_jurisdiction" text,
	"tax_exempt" boolean DEFAULT false NOT NULL,
	"tax_exemption_doc_ref" text,
	"reseller" boolean DEFAULT false NOT NULL,
	"billing_name" text,
	"billing_line1" text,
	"billing_line2" text,
	"billing_city" text,
	"billing_state" text,
	"billing_postal_code" text,
	"shipping_name" text,
	"shipping_line1" text,
	"shipping_line2" text,
	"shipping_city" text,
	"shipping_state" text,
	"shipping_postal_code" text,
	"freight_margin_pct" numeric(9, 6),
	"account_rep_username" text,
	"credit_hold" boolean DEFAULT false NOT NULL,
	"credit_hold_set_by" text,
	"credit_hold_set_at" timestamp with time zone,
	"lock_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "crm"."contact_roles" ADD CONSTRAINT "contact_roles_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "crm"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- A role row repeats its contact's reach, and this key keeps the copy true. ON UPDATE CASCADE carries
-- a new reach into the role rows, where contact_roles_reachable_check then judges it.
ALTER TABLE "crm"."contact_roles" ADD CONSTRAINT "contact_roles_reach_fkey" FOREIGN KEY ("contact_id","contact_reach") REFERENCES "crm"."contacts"("id","contact_reach") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "crm"."contacts" ADD CONSTRAINT "contacts_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "crm"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm"."customer_defaults" ADD CONSTRAINT "customer_defaults_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "crm"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm"."customer_parts" ADD CONSTRAINT "customer_parts_customer_id_customer_defaults_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "crm"."customer_defaults"("customer_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contact_roles_role_idx" ON "crm"."contact_roles" USING btree ("role","contact_id");--> statement-breakpoint
CREATE INDEX "contacts_customer_id_idx" ON "crm"."contacts" USING btree ("customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "customers_legacy_account_number_unique" ON "crm"."customers" USING btree ("legacy_account_number");--> statement-breakpoint
CREATE INDEX "customers_name_idx" ON "crm"."customers" USING btree ("name");--> statement-breakpoint
-- Part 2: CHECK constraints written by hand. The text columns refuse blank values.
ALTER TABLE "crm"."customers"
	ADD CONSTRAINT "customers_name_check"
	CHECK (length(btrim("name")) > 0);--> statement-breakpoint
ALTER TABLE "crm"."customers"
	ADD CONSTRAINT "customers_legacy_account_number_check"
	CHECK ("legacy_account_number" IS NULL OR length(btrim("legacy_account_number")) > 0);--> statement-breakpoint
ALTER TABLE "crm"."customers"
	ADD CONSTRAINT "customers_legacy_umbrella_account_number_check"
	CHECK ("legacy_umbrella_account_number" IS NULL OR length(btrim("legacy_umbrella_account_number")) > 0);--> statement-breakpoint
ALTER TABLE "crm"."customers"
	ADD CONSTRAINT "customers_payment_terms_check"
	CHECK ("payment_terms_kind" = 'net' AND "net_days" > 0);--> statement-breakpoint
ALTER TABLE "crm"."customers"
	ADD CONSTRAINT "customers_tax_jurisdiction_check"
	CHECK ("tax_jurisdiction" IS NULL OR length(btrim("tax_jurisdiction")) > 0);--> statement-breakpoint
ALTER TABLE "crm"."customers"
	ADD CONSTRAINT "customers_tax_exemption_doc_ref_check"
	CHECK ("tax_exemption_doc_ref" IS NULL OR length(btrim("tax_exemption_doc_ref")) > 0);--> statement-breakpoint
ALTER TABLE "crm"."customers"
	ADD CONSTRAINT "customers_billing_name_check"
	CHECK ("billing_name" IS NULL OR length(btrim("billing_name")) > 0);--> statement-breakpoint
ALTER TABLE "crm"."customers"
	ADD CONSTRAINT "customers_billing_line1_check"
	CHECK ("billing_line1" IS NULL OR length(btrim("billing_line1")) > 0);--> statement-breakpoint
ALTER TABLE "crm"."customers"
	ADD CONSTRAINT "customers_billing_line2_check"
	CHECK ("billing_line2" IS NULL OR length(btrim("billing_line2")) > 0);--> statement-breakpoint
ALTER TABLE "crm"."customers"
	ADD CONSTRAINT "customers_billing_city_check"
	CHECK ("billing_city" IS NULL OR length(btrim("billing_city")) > 0);--> statement-breakpoint
ALTER TABLE "crm"."customers"
	ADD CONSTRAINT "customers_billing_state_check"
	CHECK ("billing_state" IS NULL OR "billing_state" ~ '^[A-Z]{2}$');--> statement-breakpoint
ALTER TABLE "crm"."customers"
	ADD CONSTRAINT "customers_billing_postal_code_check"
	CHECK ("billing_postal_code" IS NULL OR "billing_postal_code" ~ '^[0-9]{5}(-[0-9]{4})?$');--> statement-breakpoint
ALTER TABLE "crm"."customers"
-- An address is all of line 1, city, state and postal code, or nothing at all. Same for shipping.
	ADD CONSTRAINT "customers_billing_address_check"
	CHECK (
		(
			"billing_line1" IS NULL
			AND "billing_city" IS NULL
			AND "billing_state" IS NULL
			AND "billing_postal_code" IS NULL
			AND "billing_name" IS NULL
			AND "billing_line2" IS NULL
		)
		OR (
			"billing_line1" IS NOT NULL
			AND "billing_city" IS NOT NULL
			AND "billing_state" IS NOT NULL
			AND "billing_postal_code" IS NOT NULL
		)
	);--> statement-breakpoint
ALTER TABLE "crm"."customers"
	ADD CONSTRAINT "customers_shipping_name_check"
	CHECK ("shipping_name" IS NULL OR length(btrim("shipping_name")) > 0);--> statement-breakpoint
ALTER TABLE "crm"."customers"
	ADD CONSTRAINT "customers_shipping_line1_check"
	CHECK ("shipping_line1" IS NULL OR length(btrim("shipping_line1")) > 0);--> statement-breakpoint
ALTER TABLE "crm"."customers"
	ADD CONSTRAINT "customers_shipping_line2_check"
	CHECK ("shipping_line2" IS NULL OR length(btrim("shipping_line2")) > 0);--> statement-breakpoint
ALTER TABLE "crm"."customers"
	ADD CONSTRAINT "customers_shipping_city_check"
	CHECK ("shipping_city" IS NULL OR length(btrim("shipping_city")) > 0);--> statement-breakpoint
ALTER TABLE "crm"."customers"
	ADD CONSTRAINT "customers_shipping_state_check"
	CHECK ("shipping_state" IS NULL OR "shipping_state" ~ '^[A-Z]{2}$');--> statement-breakpoint
ALTER TABLE "crm"."customers"
	ADD CONSTRAINT "customers_shipping_postal_code_check"
	CHECK ("shipping_postal_code" IS NULL OR "shipping_postal_code" ~ '^[0-9]{5}(-[0-9]{4})?$');--> statement-breakpoint
ALTER TABLE "crm"."customers"
	ADD CONSTRAINT "customers_shipping_address_check"
	CHECK (
		(
			"shipping_line1" IS NULL
			AND "shipping_city" IS NULL
			AND "shipping_state" IS NULL
			AND "shipping_postal_code" IS NULL
			AND "shipping_name" IS NULL
			AND "shipping_line2" IS NULL
		)
		OR (
			"shipping_line1" IS NOT NULL
			AND "shipping_city" IS NOT NULL
			AND "shipping_state" IS NOT NULL
			AND "shipping_postal_code" IS NOT NULL
		)
	);--> statement-breakpoint
ALTER TABLE "crm"."customers"
	ADD CONSTRAINT "customers_freight_margin_check"
	CHECK ("freight_margin_pct" IS NULL OR ("freight_margin_pct" >= 0 AND "freight_margin_pct" < 1));--> statement-breakpoint
ALTER TABLE "crm"."customers"
	ADD CONSTRAINT "customers_account_rep_username_check"
	CHECK ("account_rep_username" IS NULL OR length(btrim("account_rep_username")) > 0);--> statement-breakpoint
ALTER TABLE "crm"."customers"
	ADD CONSTRAINT "customers_credit_hold_set_by_check"
	CHECK ("credit_hold_set_by" IS NULL OR length(btrim("credit_hold_set_by")) > 0);--> statement-breakpoint
ALTER TABLE "crm"."customers"
-- A hold records who set or cleared it and when, and a customer on hold always names who set it.
-- Quoting blocks new quotes for a held customer: docs/product/requirements.md (R2).
	ADD CONSTRAINT "customers_credit_hold_actor_check"
	CHECK (("credit_hold_set_by" IS NULL) = ("credit_hold_set_at" IS NULL));--> statement-breakpoint
ALTER TABLE "crm"."customers"
	ADD CONSTRAINT "customers_credit_hold_attributed_check"
	CHECK ("credit_hold" = false OR "credit_hold_set_by" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "crm"."customers"
	ADD CONSTRAINT "customers_lock_version_check"
	CHECK ("lock_version" >= 1);--> statement-breakpoint
ALTER TABLE "crm"."contacts"
	ADD CONSTRAINT "contacts_name_check"
	CHECK (length(btrim("name")) > 0);--> statement-breakpoint
ALTER TABLE "crm"."contacts"
	ADD CONSTRAINT "contacts_email_check"
	CHECK ("email" IS NULL OR length(btrim("email")) > 0);--> statement-breakpoint
ALTER TABLE "crm"."contacts"
	ADD CONSTRAINT "contacts_phone_check"
	CHECK ("phone" IS NULL OR length(btrim("phone")) > 0);--> statement-breakpoint
ALTER TABLE "crm"."contacts"
	ADD CONSTRAINT "contacts_name_or_email_check"
	CHECK ("name" IS NOT NULL OR "email" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "crm"."contacts"
	ADD CONSTRAINT "contacts_lock_version_check"
	CHECK ("lock_version" >= 1);--> statement-breakpoint
ALTER TABLE "crm"."contact_roles"
	ADD CONSTRAINT "contact_roles_role_check"
	CHECK ("role" IN ('quote', 'order_confirmation', 'production'));--> statement-breakpoint
ALTER TABLE "crm"."contact_roles"
-- Mail roles need an email address. production needs an email address or a phone.
	ADD CONSTRAINT "contact_roles_reachable_check"
	CHECK (
		("role" = 'production' AND "contact_reach" <> 'none')
		OR ("role" <> 'production' AND "contact_reach" IN ('email', 'both'))
	);--> statement-breakpoint
ALTER TABLE "crm"."contact_roles"
	ADD CONSTRAINT "contact_roles_set_by_check"
	CHECK (length(btrim("set_by")) > 0);--> statement-breakpoint
ALTER TABLE "crm"."customer_defaults"
	ADD CONSTRAINT "customer_defaults_pricing_basis_check"
	CHECK ("pricing_basis" IS NULL OR "pricing_basis" IN ('per_roll', 'per_pound'));--> statement-breakpoint
ALTER TABLE "crm"."customer_defaults"
	ADD CONSTRAINT "customer_defaults_tier_code_check"
	CHECK ("tier_code" IS NULL OR (char_length("tier_code") BETWEEN 1 AND 32 AND "tier_code" ~ '^[a-z][a-z0-9_]*$'));--> statement-breakpoint
ALTER TABLE "crm"."customer_defaults"
	ADD CONSTRAINT "customer_defaults_freight_mode_check"
	CHECK ("freight_mode" IS NULL OR "freight_mode" IN ('pickup', 'our_vehicle', 'pass_through', 'carrier'));--> statement-breakpoint
ALTER TABLE "crm"."customer_defaults"
	ADD CONSTRAINT "customer_defaults_lead_time_days_range_check"
	CHECK ("lead_time_days" IS NULL OR ("lead_time_days" >= 0 AND "lead_time_days" <= 3650));--> statement-breakpoint
ALTER TABLE "crm"."customer_defaults"
	ADD CONSTRAINT "customer_defaults_lock_version_check"
	CHECK ("lock_version" >= 1);--> statement-breakpoint
ALTER TABLE "crm"."customer_defaults"
	ADD CONSTRAINT "customer_defaults_updated_by_check"
	CHECK (length(btrim("updated_by")) > 0);--> statement-breakpoint
ALTER TABLE "crm"."customer_parts"
	ADD CONSTRAINT "customer_parts_position_check"
	CHECK ("position" >= 0);--> statement-breakpoint
ALTER TABLE "crm"."customer_parts"
	ADD CONSTRAINT "customer_parts_roll_width_in_check"
	CHECK ("roll_width_in" >= 1 AND "roll_width_in" <= 1000);--> statement-breakpoint
ALTER TABLE "crm"."customer_parts"
-- Widths are whole sixteenths of an inch, which a JS number holds exactly.
	ADD CONSTRAINT "customer_parts_roll_width_sixteenths_check"
	CHECK ("roll_width_in" * 16 = trunc("roll_width_in" * 16));--> statement-breakpoint
ALTER TABLE "crm"."customer_parts"
	ADD CONSTRAINT "customer_parts_part_number_check"
	CHECK ("part_number" IS NULL OR (char_length("part_number") BETWEEN 1 AND 40 AND "part_number" = btrim("part_number")));--> statement-breakpoint
ALTER TABLE "crm"."customer_parts"
	ADD CONSTRAINT "customer_parts_description_check"
	CHECK ("description" IS NULL OR (char_length("description") BETWEEN 1 AND 120 AND "description" = btrim("description")));--> statement-breakpoint
ALTER TABLE "crm"."customer_parts"
	ADD CONSTRAINT "customer_parts_has_a_name_check"
	CHECK ("part_number" IS NOT NULL OR "description" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "crm"."customer_parts"
	ADD CONSTRAINT "customer_parts_feet_per_roll_check"
	CHECK ("feet_per_roll" IS NULL OR "feet_per_roll" > 0);--> statement-breakpoint
ALTER TABLE "crm"."customer_parts"
	ADD CONSTRAINT "customer_parts_agreed_price_basis_check"
	CHECK ("agreed_price_basis" IS NULL OR "agreed_price_basis" IN ('per_pound', 'per_roll'));--> statement-breakpoint
ALTER TABLE "crm"."customer_parts"
	ADD CONSTRAINT "customer_parts_agreed_price_positive_check"
	CHECK ("agreed_price" IS NULL OR "agreed_price" > 0);--> statement-breakpoint
ALTER TABLE "crm"."customer_parts"
-- An agreed price is stored with its basis and who set it and when, or not at all.
	ADD CONSTRAINT "customer_parts_agreed_price_together_check"
	CHECK (
		(
			"agreed_price_basis" IS NULL
			AND "agreed_price" IS NULL
			AND "agreed_price_set_by" IS NULL
			AND "agreed_price_set_at" IS NULL
		)
		OR (
			"agreed_price_basis" IS NOT NULL
			AND "agreed_price" IS NOT NULL
			AND "agreed_price_set_by" IS NOT NULL
			AND "agreed_price_set_at" IS NOT NULL
			AND length(btrim("agreed_price_set_by")) > 0
		)
	);
