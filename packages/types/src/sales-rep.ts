// Sales reps as pages offer them, and usernames resolved to display names.
import { z } from 'zod';

export const salesRepUsernameSchema = z.string().trim().min(1).max(128);

export const salesRepSchema = z.object({
  username: salesRepUsernameSchema,
  displayName: z.string().min(1),
});

export type SalesRep = z.infer<typeof salesRepSchema>;

export const salesRepListResponseSchema = z.object({
  items: z.array(salesRepSchema),
});

export type SalesRepListResponse = z.infer<typeof salesRepListResponseSchema>;

export const resolvedSalesRepSchema = z.object({
  username: salesRepUsernameSchema,

  displayName: z.string().min(1).optional(),

  offerable: z.boolean(),
});

export type ResolvedSalesRep = z.infer<typeof resolvedSalesRepSchema>;

export const resolvedSalesRepListResponseSchema = z.object({
  items: z.array(resolvedSalesRepSchema),
});

export type ResolvedSalesRepListResponse = z.infer<typeof resolvedSalesRepListResponseSchema>;

export const SALES_REP_RESOLVE_MAX_NAMES = 100;

export function salesRepLabel(rep: ResolvedSalesRep): string {
  return rep.displayName ?? rep.username;
}
