// The Approvals queue as one union: credit-hold exceptions and quotes waiting on a price or floor decision.
// It is composed in apps/api/src/approvals/approvals.controller.ts, not kept in a shared store: docs/decisions/README.md.
import { z } from 'zod';

import { quoteOverrideKindSchema } from './quote';

const reasonSchema = z.string().trim().min(1).max(1000);

const actorSchema = z.string().trim().min(1).max(128);

export const pendingCreditHoldSchema = z.object({
  kind: z.literal('credit-hold'),
  approvalId: z.uuid(),
  customerId: z.uuid(),
  reason: reasonSchema,
  requestedBy: actorSchema,
  requestedAt: z.iso.datetime(),
});

export type PendingCreditHold = z.infer<typeof pendingCreditHoldSchema>;

export const pendingPriceOverrideSchema = z.object({
  kind: z.literal('price-override'),

  quoteId: z.string().min(1),
  customerId: z.string().min(1),

  quoteNumber: z.number().int().positive(),
  versionNumber: z.number().int().positive(),
  salesRep: z.string().trim().max(128).optional(),
  requestedAt: z.iso.datetime(),

  needs: z.array(quoteOverrideKindSchema).min(1),
});

export type PendingPriceOverride = z.infer<typeof pendingPriceOverrideSchema>;

export const pendingApprovalSchema = z.discriminatedUnion('kind', [
  pendingCreditHoldSchema,
  pendingPriceOverrideSchema,
]);

export type PendingApproval = z.infer<typeof pendingApprovalSchema>;

export const pendingApprovalListResponseSchema = z.object({
  items: z.array(pendingApprovalSchema),
});

export type PendingApprovalListResponse = z.infer<typeof pendingApprovalListResponseSchema>;
