-- Baseline of the orders schema, owned by modules/orders (modules/orders/README.md).
-- Two parts: the schema drizzle-kit generates from modules/orders/src/data/schema.ts, then the job
-- number sequence and CHECK constraints written by hand. There are no reference rows.
--
-- Part 1: generated from modules/orders/src/data/schema.ts.
CREATE SCHEMA "orders";
--> statement-breakpoint
CREATE TABLE "orders"."order_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"order_id" uuid NOT NULL,
	"line_number" integer NOT NULL,
	"quote_line_id" uuid,
	"grade_id" uuid NOT NULL,
	"footage_variant" text NOT NULL,
	"feet_per_roll" numeric(12, 4),
	"roll_width_in" numeric(8, 4) NOT NULL,
	"custom_width" boolean DEFAULT false NOT NULL,
	"quantity_rolls" integer NOT NULL,
	"overwrap" boolean NOT NULL,
	"pallets" integer,
	"revenue_category" text NOT NULL,
	"tax_status" text NOT NULL,
	"tax_jurisdiction" text,
	"printed" boolean NOT NULL,
	"customer_part_number" text,
	"customer_description" text,
	"estimated_weight_lb" numeric(12, 4) NOT NULL,
	"pricing_basis" text DEFAULT 'per_roll' NOT NULL,
	"ordered_weight_lb" numeric(12, 4),
	"price_per_roll" numeric(19, 4) NOT NULL,
	"product_price_per_lb" numeric(19, 4),
	"total_cost_per_roll" numeric(19, 4) NOT NULL,
	"extended_price" numeric(19, 4) NOT NULL,
	"extended_cost" numeric(19, 4) NOT NULL,
	"extended_margin" numeric(19, 4) NOT NULL,
	"roll_weight_lb" numeric(12, 4),
	"paper_cost_per_lb" numeric(19, 8),
	"paper_cost_per_roll" numeric(19, 4),
	"freight_mode" text NOT NULL,
	"freight_rate_override" numeric(19, 4),
	"freight_carrier_bid" numeric(19, 4),
	"freight_margin_pct" numeric(9, 6),
	"freight_cost" numeric(19, 4) NOT NULL,
	"freight_margin" numeric(19, 4) NOT NULL,
	"freight_invoice_total" numeric(19, 4) NOT NULL,
	"freight_pending" boolean DEFAULT false NOT NULL,
	"delivery_name" text,
	"delivery_line1" text,
	"delivery_line2" text,
	"delivery_city" text,
	"delivery_state" text,
	"delivery_postal_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders"."order_transitions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"order_id" uuid NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"reason" text,
	"actor" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders"."orders" (
	"id" uuid PRIMARY KEY NOT NULL,
	"quote_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"status" text NOT NULL,
	"job_number" text,
	"confirmed_lead_time_days" integer,
	"confirmed_by" text,
	"confirmed_at" timestamp with time zone,
	"sales_rep" text,
	"po_number" text,
	"po_captured_by" text,
	"po_captured_at" timestamp with time zone,
	"requested_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lock_version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "orders"."order_lines" ADD CONSTRAINT "order_lines_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "orders"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders"."order_transitions" ADD CONSTRAINT "order_transitions_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "orders"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "order_lines_order_id_idx" ON "orders"."order_lines" USING btree ("order_id","line_number");--> statement-breakpoint
CREATE UNIQUE INDEX "order_lines_quote_line_id_order_id_unique" ON "orders"."order_lines" USING btree ("quote_line_id","order_id");--> statement-breakpoint
CREATE INDEX "order_transitions_order_id_idx" ON "orders"."order_transitions" USING btree ("order_id","at");--> statement-breakpoint
CREATE INDEX "orders_quote_id_idx" ON "orders"."orders" USING btree ("quote_id");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_job_number_unique" ON "orders"."orders" USING btree ("job_number");--> statement-breakpoint
CREATE INDEX "orders_status_idx" ON "orders"."orders" USING btree ("status");--> statement-breakpoint
CREATE INDEX "orders_customer_id_idx" ON "orders"."orders" USING btree ("customer_id");--> statement-breakpoint
-- Part 2: written by hand.
-- Job numbers are taken from this sequence at confirmation, by mintJobNumber in
-- modules/orders/src/adapters/drizzle/drizzle-order-repository.ts. A value is never reused.
CREATE SEQUENCE "orders"."job_number_seq" AS bigint START WITH 1 INCREMENT BY 1;
--> statement-breakpoint
ALTER TABLE "orders"."orders"
-- The only statuses in the order lifecycle: ORDER_TRANSITIONS in packages/types/src/order.ts.
	ADD CONSTRAINT "orders_status_check" CHECK ("status" IN ('converted', 'confirmed'));
--> statement-breakpoint
ALTER TABLE "orders"."order_transitions"
	ADD CONSTRAINT "order_transitions_to_status_check" CHECK ("to_status" IN ('converted', 'confirmed'));
--> statement-breakpoint
ALTER TABLE "orders"."order_transitions"
	ADD CONSTRAINT "order_transitions_from_status_check" CHECK ("from_status" IS NULL OR "from_status" IN ('converted', 'confirmed'));
--> statement-breakpoint
ALTER TABLE "orders"."orders"
-- A confirmation is recorded whole: job number, confirmer, time and committed lead time appear
-- together or not at all. docs/product/requirements.md (R11).
	ADD CONSTRAINT "orders_confirmation_record_check" CHECK (
		("job_number" IS NULL) = ("confirmed_at" IS NULL)
		AND ("confirmed_by" IS NULL) = ("confirmed_at" IS NULL)
		AND ("confirmed_lead_time_days" IS NULL) = ("confirmed_at" IS NULL)
	);
--> statement-breakpoint
ALTER TABLE "orders"."orders"
	ADD CONSTRAINT "orders_lead_time_check" CHECK ("confirmed_lead_time_days" IS NULL OR "confirmed_lead_time_days" >= 0);
--> statement-breakpoint
ALTER TABLE "orders"."orders"
	ADD CONSTRAINT "orders_lock_version_check" CHECK ("lock_version" >= 1);
--> statement-breakpoint
ALTER TABLE "orders"."orders"
-- A PO number is stored with who recorded it and when. docs/product/requirements.md (R9).
	ADD CONSTRAINT "orders_po_all_or_none_check" CHECK (
		("po_number" IS NULL AND "po_captured_by" IS NULL AND "po_captured_at" IS NULL)
		OR ("po_number" IS NOT NULL AND "po_captured_by" IS NOT NULL AND "po_captured_at" IS NOT NULL)
	);
--> statement-breakpoint
ALTER TABLE "orders"."order_lines"
	ADD CONSTRAINT "order_lines_line_number_check" CHECK ("line_number" >= 1);
--> statement-breakpoint
ALTER TABLE "orders"."order_lines"
	ADD CONSTRAINT "order_lines_quantity_check" CHECK ("quantity_rolls" >= 1);
--> statement-breakpoint
ALTER TABLE "orders"."order_lines"
	ADD CONSTRAINT "order_lines_pallets_check" CHECK ("pallets" >= 0);
--> statement-breakpoint
ALTER TABLE "orders"."order_lines"
	ADD CONSTRAINT "order_lines_roll_width_check" CHECK ("roll_width_in" >= 1);
--> statement-breakpoint
ALTER TABLE "orders"."order_lines"
	ADD CONSTRAINT "order_lines_roll_width_sixteenths_check" CHECK ("roll_width_in" * 16 = trunc("roll_width_in" * 16));
--> statement-breakpoint
ALTER TABLE "orders"."order_lines"
-- A custom width, one not in the grade's stocked widths, is a whole number of inches.
	ADD CONSTRAINT "order_lines_custom_width_whole_check" CHECK (NOT "custom_width" OR "roll_width_in" = trunc("roll_width_in"));
--> statement-breakpoint
ALTER TABLE "orders"."order_lines"
	ADD CONSTRAINT "order_lines_total_cost_per_roll_check" CHECK ("total_cost_per_roll" >= 0);
--> statement-breakpoint
ALTER TABLE "orders"."order_lines"
	ADD CONSTRAINT "order_lines_revenue_category_check" CHECK ("revenue_category" IN (
		'print', 'label', 'freight', 'design'
	));
--> statement-breakpoint
ALTER TABLE "orders"."order_lines"
	ADD CONSTRAINT "order_lines_tax_status_check" CHECK ("tax_status" IN ('id_tax', 'wa_tax', 'non_tax'));
--> statement-breakpoint
ALTER TABLE "orders"."order_lines"
-- A taxed line names its jurisdiction and a non-taxable one names none.
	ADD CONSTRAINT "order_lines_tax_treatment_check" CHECK (("tax_status" = 'non_tax') = ("tax_jurisdiction" IS NULL));
--> statement-breakpoint
ALTER TABLE "orders"."order_lines"
	ADD CONSTRAINT "order_lines_customer_part_number_check" CHECK (
		"customer_part_number" IS NULL
		OR (
			char_length("customer_part_number") BETWEEN 1 AND 40
			AND "customer_part_number" = btrim("customer_part_number")
		)
	);
--> statement-breakpoint
ALTER TABLE "orders"."order_lines"
	ADD CONSTRAINT "order_lines_customer_description_check" CHECK (
		"customer_description" IS NULL
		OR (
			char_length("customer_description") BETWEEN 1 AND 120
			AND "customer_description" = btrim("customer_description")
		)
	);
--> statement-breakpoint
ALTER TABLE "orders"."order_lines"
	ADD CONSTRAINT "order_lines_delivery_address_check" CHECK (
		(
			"delivery_line1" IS NULL AND "delivery_city" IS NULL AND "delivery_state" IS NULL
			AND "delivery_postal_code" IS NULL AND "delivery_name" IS NULL AND "delivery_line2" IS NULL
		)
		OR (
			"delivery_line1" IS NOT NULL AND "delivery_city" IS NOT NULL
			AND "delivery_state" IS NOT NULL AND "delivery_postal_code" IS NOT NULL
		)
	);
--> statement-breakpoint
ALTER TABLE "orders"."order_lines"
	ADD CONSTRAINT "order_lines_delivery_state_check" CHECK ("delivery_state" IS NULL OR "delivery_state" ~ '^[A-Z]{2}$');
--> statement-breakpoint
ALTER TABLE "orders"."order_lines"
	ADD CONSTRAINT "order_lines_delivery_postal_code_check" CHECK ("delivery_postal_code" IS NULL OR "delivery_postal_code" ~ '^[0-9]{5}(-[0-9]{4})?$');
--> statement-breakpoint
ALTER TABLE "orders"."order_lines"
	ADD CONSTRAINT "order_lines_pricing_basis_check" CHECK ("pricing_basis" IN ('per_roll', 'per_pound'));
--> statement-breakpoint
ALTER TABLE "orders"."order_lines"
-- A per-pound line carries its price per pound, roll weight and pounds ordered. A per-roll line
-- carries no price per pound and no pounds ordered.
	ADD CONSTRAINT "order_lines_per_pound_price_check" CHECK (("pricing_basis" = 'per_pound') = ("product_price_per_lb" IS NOT NULL));
--> statement-breakpoint
ALTER TABLE "orders"."order_lines"
	ADD CONSTRAINT "order_lines_per_pound_weight_check" CHECK ("pricing_basis" <> 'per_pound' OR "roll_weight_lb" IS NOT NULL);
--> statement-breakpoint
ALTER TABLE "orders"."order_lines"
	ADD CONSTRAINT "order_lines_ordered_weight_check" CHECK (
		("pricing_basis" = 'per_pound') = ("ordered_weight_lb" IS NOT NULL)
		AND ("ordered_weight_lb" IS NULL OR "ordered_weight_lb" > 0)
	);
--> statement-breakpoint
ALTER TABLE "orders"."order_lines"
	ADD CONSTRAINT "order_lines_freight_mode_check" CHECK ("freight_mode" IN ('pickup', 'our_vehicle', 'pass_through', 'carrier'));
--> statement-breakpoint
ALTER TABLE "orders"."order_lines"
	ADD CONSTRAINT "order_lines_freight_rate_override_check" CHECK ("freight_rate_override" IS NULL OR "freight_mode" IN ('our_vehicle', 'pass_through'));
--> statement-breakpoint
ALTER TABLE "orders"."order_lines"
	ADD CONSTRAINT "order_lines_freight_carrier_bid_check" CHECK ("freight_carrier_bid" IS NULL OR "freight_mode" IN ('pass_through', 'carrier'));
--> statement-breakpoint
ALTER TABLE "orders"."order_lines"
	ADD CONSTRAINT "order_lines_freight_margin_pct_check" CHECK (
		"freight_margin_pct" IS NULL
		OR ("freight_mode" = 'carrier' AND "freight_margin_pct" >= 0 AND "freight_margin_pct" < 1)
	);
--> statement-breakpoint
ALTER TABLE "orders"."order_lines"
	ADD CONSTRAINT "order_lines_freight_nonneg_check" CHECK (
		"freight_cost" >= 0
		AND "freight_margin" >= 0
		AND "freight_invoice_total" >= 0
		AND ("freight_carrier_bid" IS NULL OR "freight_carrier_bid" >= 0)
		AND ("freight_rate_override" IS NULL OR "freight_rate_override" >= 0)
	);
--> statement-breakpoint
ALTER TABLE "orders"."order_lines"
-- Freight billed is cost plus margin, kept apart from the roll price. docs/product/requirements.md (R4).
	ADD CONSTRAINT "order_lines_freight_total_check" CHECK ("freight_invoice_total" = "freight_cost" + "freight_margin");
--> statement-breakpoint
ALTER TABLE "orders"."order_lines"
-- Pending freight waits on a carrier bid and shows TBD until it is entered.
-- docs/product/requirements.md (R4).
	ADD CONSTRAINT "order_lines_freight_pending_check" CHECK (
		"freight_pending" = false
		OR (
			"freight_mode" = 'carrier' AND "freight_carrier_bid" IS NULL
			AND "freight_cost" = 0 AND "freight_margin" = 0 AND "freight_invoice_total" = 0
		)
		OR (
			"freight_mode" = 'pass_through' AND "freight_carrier_bid" IS NULL AND "freight_margin" = 0
		)
	);
