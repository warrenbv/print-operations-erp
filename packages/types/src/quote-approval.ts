// The credit-hold exception: Sales asks to quote a customer on hold, and the Billing Manager approves or refuses.
// An approved exception permits exactly one quote and does not lift the hold: docs/product/requirements.md (R2).
// The baseline allows one unspent approval per customer: `quote_approvals_one_unspent_per_customer` in
// infra/db/migrations/quoting/0000_baseline.sql.
import { z } from 'zod';

export const QUOTE_APPROVAL_STATUSES = ['pending', 'approved', 'rejected'] as const;

export const quoteApprovalStatusSchema = z.enum(QUOTE_APPROVAL_STATUSES);

export type QuoteApprovalStatus = z.infer<typeof quoteApprovalStatusSchema>;

const reasonSchema = z.string().trim().min(1).max(1000);

const actorSchema = z.string().trim().min(1).max(128);

export const quoteApprovalSchema = z.object({
  id: z.uuid(),

  customerId: z.uuid(),
  status: quoteApprovalStatusSchema,

  reason: reasonSchema,
  requestedBy: actorSchema,
  requestedAt: z.iso.datetime(),
  decidedBy: actorSchema.optional(),
  decidedAt: z.iso.datetime().optional(),

  decisionReason: reasonSchema.optional(),

  // Set in the same transaction that creates the quote, which spends the approval: docs/decisions/README.md.
  spentByQuoteId: z.uuid().optional(),
  spentAt: z.iso.datetime().optional(),
});

export type QuoteApproval = z.infer<typeof quoteApprovalSchema>;

export const requestQuoteApprovalSchema = z.object({
  customerId: z.uuid(),
  reason: reasonSchema,
});

export type RequestQuoteApproval = z.infer<typeof requestQuoteApprovalSchema>;

export const decideQuoteApprovalSchema = z.discriminatedUnion('decision', [
  z.object({ decision: z.literal('approved') }),
  z.object({ decision: z.literal('rejected'), reason: reasonSchema }),
]);

export type DecideQuoteApproval = z.infer<typeof decideQuoteApprovalSchema>;

export const quoteApprovalListResponseSchema = z.object({
  items: z.array(quoteApprovalSchema),
});

export type QuoteApprovalListResponse = z.infer<typeof quoteApprovalListResponseSchema>;
