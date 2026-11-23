// The quote, its lines, its state machine, and the request shapes for editing, deciding on and sending it.
// The quoting module enforces the rules these shapes carry: modules/quoting/src/services/quote-service.ts.
// The lists here are mirrored by CHECK constraints in infra/db/migrations/quoting/0000_baseline.sql.
import { z } from 'zod';

import { revenueCategorySchema, taxJurisdictionSchema, taxStatusSchema } from './revenue';

import { measureSchema, moneySchema, rateSchema } from './decimal';
import { customerDescriptionSchema, customerPartNumberSchema } from './customer-part';
import { deliveryAddressSchema } from './delivery-address';
import { freightInputSchema, freightResultSchema } from './freight';
import { pricingBasisSchema } from './pricing-basis';
import { floorStatusSchema, priceSourceSchema, quoteLineInputSchema } from './quote-calculation';
import { rollCostBreakdownSchema } from './roll-cost';
import { rollWidthSchema } from './roll-width';
import { tierSelectionSourceSchema } from './pricing-tier';
import {
  sendAudienceSchema,
  sendFailureReasonSchema,
  sendKindSchema,
  sendOutcomeSchema,
} from './send-log';

export const QUOTE_STATUSES = [
  'draft',
  'override_requested',
  'quoted',
  'superseded',
  'closed_lost',
] as const;

export const quoteStatusSchema = z.enum(QUOTE_STATUSES);

export type QuoteStatus = z.infer<typeof quoteStatusSchema>;

/**
 * Asking for a price approval moves a draft to `override_requested`, and the decision returns it
 * to `draft`: docs/product/requirements.md (R7). Sending moves it to `quoted`. A revision supersedes
 * a quoted quote. Enforced by modules/quoting/src/quote-state-machine.ts.
 */
export const QUOTE_TRANSITIONS: Readonly<Record<QuoteStatus, readonly QuoteStatus[]>> = {
  draft: ['quoted', 'override_requested', 'closed_lost'],

  override_requested: ['draft', 'quoted', 'closed_lost'],

  quoted: ['superseded', 'closed_lost'],

  superseded: [],
  closed_lost: [],
};

export const TERMINAL_QUOTE_STATUSES = QUOTE_STATUSES.filter(
  (status) => QUOTE_TRANSITIONS[status].length === 0,
);

export const INITIAL_QUOTE_STATUS: QuoteStatus = 'draft';

// A sent quote can no longer be edited.
export const EDITABLE_QUOTE_STATUSES: readonly QuoteStatus[] = ['draft', 'override_requested'];

// Only a sent quote converts to an order: docs/product/requirements.md (R10).
export const CONVERTIBLE_QUOTE_STATUSES: readonly QuoteStatus[] = ['quoted'];

export const PRINTABLE_QUOTE_STATUSES: readonly QuoteStatus[] = ['quoted', 'superseded'];

export const quoteIdSchema = z.string().min(1);

// The tier as it stood when the line was priced. The tier snapshot stays in quoting and does not
// cross to orders: docs/decisions/002-what-crosses-a-module-boundary.md.
export const quotedTierSchema = z.object({
  id: z.string().min(1),

  code: z.string().trim().min(1).max(32),
  name: z.string().trim().min(1).max(128),

  marginPct: rateSchema,

  source: tierSelectionSourceSchema,
});

export type QuotedTier = z.infer<typeof quotedTierSchema>;

export const quoteLineSchema = z.object({
  id: z.string().min(1),
  quoteId: quoteIdSchema,

  lineNumber: z.number().int().positive(),

  gradeId: z.string().min(1),
  footageVariant: z.string().trim().min(1).max(32),

  rollWidthIn: rollWidthSchema,

  customWidth: z.boolean().optional(),

  quantityRolls: z.number().int().positive(),

  orderedWeightLb: measureSchema.optional(),
  overwrap: z.boolean(),

  pricingBasis: pricingBasisSchema,

  feetPerRollOverride: measureSchema.optional(),
  convertCostPerTon: moneySchema.optional(),
  printCostPerTon: moneySchema.optional(),

  tierOverrideCode: z.string().trim().min(1).max(32).optional(),

  // A hand-set price. It needs the Billing Manager's approval before the quote can be sent:
  // docs/product/requirements.md (R7).
  overridePricePerRoll: moneySchema.optional(),

  overridePricePerLb: moneySchema.optional(),

  marginOverridePct: rateSchema.optional(),

  freight: freightInputSchema,

  deliveryAddress: deliveryAddressSchema.optional(),

  revenueCategory: revenueCategorySchema,

  taxStatus: taxStatusSchema,
  taxJurisdiction: taxJurisdictionSchema.optional(),

  printed: z.boolean(),

  customerPartNumber: customerPartNumberSchema.optional(),

  customerDescription: customerDescriptionSchema.optional(),

  cost: rollCostBreakdownSchema,
  tier: quotedTierSchema,

  pallets: z.number().int().nonnegative().nullable(),

  basePricePerRoll: moneySchema,

  pricePerRoll: moneySchema,

  priceSource: priceSourceSchema,

  marginPricePerRoll: moneySchema.optional(),
  deliveredPricePerRoll: moneySchema,

  marginPct: rateSchema,
  // The stored floor verdict is the verdict. Nothing downstream recomputes it.
  floor: floorStatusSchema,

  extendedPrice: moneySchema,
  extendedCost: moneySchema,
  extendedMargin: moneySchema,

  freightResult: freightResultSchema,

  estimatedWeightLb: measureSchema,

  pricePerLb: moneySchema,
  effectivePricePerLb: moneySchema,

  basePricePerLb: moneySchema.optional(),

  productPricePerLb: moneySchema.optional(),

  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export type QuoteLine = z.infer<typeof quoteLineSchema>;

export const quoteSchema = z.object({
  id: quoteIdSchema,

  customerId: z.string().min(1),
  status: quoteStatusSchema,

  rootQuoteId: z.string().min(1),

  // Counts revisions in the supersede chain. It does not change when lines are edited, so it is not
  // the concurrency token: docs/decisions/006-optimistic-concurrency.md.
  versionNumber: z.number().int().positive(),

  quoteNumber: z.number().int().positive(),

  // Bumped by every write to the quote or its lines. A state-changing request sends back the value it
  // read and a mismatch is refused: docs/decisions/006-optimistic-concurrency.md.
  lockVersion: z.number().int().positive(),

  // Entered by Production. A quote cannot be sent without it: docs/product/requirements.md (R5).
  leadTimeDays: z.number().int().nonnegative().max(3650).optional(),

  leadTimeSetBy: z.string().trim().min(1).max(128).optional(),
  leadTimeSetAt: z.iso.datetime().optional(),

  salesRep: z.string().trim().max(128).optional(),

  notes: z.string().trim().max(4_000).optional(),

  freightInRollPrice: z.boolean(),

  overrideApprovedBy: z.string().trim().min(1).max(128).optional(),
  overrideApprovedAt: z.iso.datetime().optional(),

  // Set when an Admin overrides the floor. Editing the lines revokes it: docs/product/requirements.md (R6).
  floorOverrideBy: z.string().trim().min(1).max(128).optional(),
  floorOverrideAt: z.iso.datetime().optional(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export type Quote = z.infer<typeof quoteSchema>;

export const quoteWithLinesSchema = quoteSchema.extend({
  lines: z.array(quoteLineSchema),
});

export type QuoteWithLines = z.infer<typeof quoteWithLinesSchema>;

export const setQuoteLeadTimeRequestSchema = z.object({
  leadTimeDays: z.number().int().nonnegative().max(3650),
  lockVersion: z.number().int().positive(),
});

export type SetQuoteLeadTimeRequest = z.infer<typeof setQuoteLeadTimeRequestSchema>;

export const quoteTotalsSchema = z.object({
  extendedPrice: moneySchema,
  extendedCost: moneySchema,
  extendedMargin: moneySchema,

  estimatedWeightLb: measureSchema,
});

export type QuoteTotals = z.infer<typeof quoteTotalsSchema>;

export const createQuoteRequestSchema = z.object({
  customerId: z.string().min(1),
  salesRep: z.string().trim().max(128).optional(),
  notes: z.string().trim().max(4_000).optional(),
});

export type CreateQuoteRequest = z.infer<typeof createQuoteRequestSchema>;

export const setQuoteLinesRequestSchema = z.object({
  lines: z.array(quoteLineInputSchema).max(200),

  lockVersion: z.coerce.number().int().positive(),

  freightInRollPrice: z.boolean().optional(),
});

export type SetQuoteLinesRequest = z.infer<typeof setQuoteLinesRequestSchema>;

export const QUOTE_OVERRIDE_DECISIONS = ['requested', 'approved', 'rejected', 'revoked'] as const;

export const quoteOverrideDecisionKindSchema = z.enum(QUOTE_OVERRIDE_DECISIONS);

export type QuoteOverrideDecisionKind = z.infer<typeof quoteOverrideDecisionKindSchema>;

// `price` is the Billing Manager's approval of a hand-set price (R7). `floor` is an Admin's override of the
// margin floor (R6). Both rules: docs/product/requirements.md.
export const QUOTE_OVERRIDE_KINDS = ['price', 'floor'] as const;

export const quoteOverrideKindSchema = z.enum(QUOTE_OVERRIDE_KINDS);

export type QuoteOverrideKind = z.infer<typeof quoteOverrideKindSchema>;

export const quoteOverrideDecisionSchema = z.object({
  id: z.string().min(1),
  quoteId: quoteIdSchema,
  decision: quoteOverrideDecisionKindSchema,

  kind: quoteOverrideKindSchema,

  actor: z.string().trim().min(1).max(128),

  reason: z.string().trim().max(500).optional(),
  at: z.iso.datetime(),
});

export type QuoteOverrideDecision = z.infer<typeof quoteOverrideDecisionSchema>;

export const overrideDecisionRequestSchema = z.object({
  // The API sets `actor` from the session before parsing: apps/api/src/quoting/quotes.controller.ts.
  actor: z.string().trim().min(1).max(128),
  lockVersion: z.coerce.number().int().positive(),
  reason: z.string().trim().max(500).optional(),
});

export type OverrideDecisionRequest = z.infer<typeof overrideDecisionRequestSchema>;

// A floor override must carry its reason: docs/product/requirements.md (R6).
export const floorOverrideDecisionRequestSchema = overrideDecisionRequestSchema.extend({
  reason: z.string().trim().min(1).max(500),
});

export type FloorOverrideDecisionRequest = z.infer<typeof floorOverrideDecisionRequestSchema>;

export const quoteSendSchema = z.object({
  id: z.string().min(1),
  quoteId: quoteIdSchema,

  messageId: z.string().trim().min(1),

  actor: z.string().trim().min(1).max(128),

  acceptedByRelayAt: z.iso.datetime(),
});

export type QuoteSend = z.infer<typeof quoteSendSchema>;

export const quoteSendAttemptSchema = z.object({
  messageId: z.string().trim().min(1),

  recipients: z.array(z.string().trim().min(1)),

  audience: sendAudienceSchema,

  actor: z.string().trim().min(1),

  submittedAt: z.iso.datetime(),
  outcome: sendOutcomeSchema,
  failureReason: sendFailureReasonSchema.optional(),

  unreachableHolders: z.array(z.string().trim().min(1)),

  redirectedTo: z.array(z.string().trim().min(1)).optional(),

  kind: sendKindSchema.optional(),
});

export type QuoteSendAttempt = z.infer<typeof quoteSendAttemptSchema>;

export const quoteSendAttemptListResponseSchema = z.object({
  items: z.array(quoteSendAttemptSchema),
});

export type QuoteSendAttemptListResponse = z.infer<typeof quoteSendAttemptListResponseSchema>;

export const sendQuoteRequestSchema = z.object({
  lockVersion: z.coerce.number().int().positive(),
  confirmRedistribute: z.boolean().optional().default(false),

  confirmRecipients: z.array(z.email()).optional(),
});

export type SendQuoteRequest = z.infer<typeof sendQuoteRequestSchema>;

export const reviseQuoteRequestSchema = z.object({
  notes: z.string().trim().max(4_000).optional(),
});

export type ReviseQuoteRequest = z.infer<typeof reviseQuoteRequestSchema>;

export const transitionQuoteRequestSchema = z.object({
  to: quoteStatusSchema,
  lockVersion: z.coerce.number().int().positive(),
});

export type TransitionQuoteRequest = z.infer<typeof transitionQuoteRequestSchema>;

export const quoteListItemSchema = quoteSchema.extend({
  lineCount: z.number().int().nonnegative(),

  belowFloorCount: z.number().int().nonnegative(),

  manualCount: z.number().int().nonnegative(),

  manualPricePerRoll: moneySchema.nullable(),

  productionToldAt: z.iso.datetime().nullable().optional(),
});

export type QuoteListItem = z.infer<typeof quoteListItemSchema>;

export const quoteListResponseSchema = z.object({
  items: z.array(quoteListItemSchema),
});

export type QuoteListResponse = z.infer<typeof quoteListResponseSchema>;

export const quoteVersionsResponseSchema = z.object({
  items: z.array(quoteSchema),
});

export type QuoteVersionsResponse = z.infer<typeof quoteVersionsResponseSchema>;

export const quoteOverrideDecisionListResponseSchema = z.object({
  items: z.array(quoteOverrideDecisionSchema),
});

export type QuoteOverrideDecisionListResponse = z.infer<
  typeof quoteOverrideDecisionListResponseSchema
>;

/**
 * The floor's answer on sending: sendable, or the lines below the floor with the lowest price each
 * would need. Only an Admin's floor override releases those lines: docs/product/requirements.md (R6).
 */
export const quoteSendabilitySchema = z.discriminatedUnion('sendable', [
  z.object({ sendable: z.literal(true) }),
  z.object({
    sendable: z.literal(false),
    belowFloor: z.array(
      z.object({
        lineNumber: z.number().int().positive(),

        minimumPricePerRoll: moneySchema,
      }),
    ),
  }),
]);

export type QuoteSendability = z.infer<typeof quoteSendabilitySchema>;
