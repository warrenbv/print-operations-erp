// The count and oldest item of a queue. Your work shows one for each of the signed-in desk's queues:
// docs/product/requirements.md (R12). The web side: apps/web/src/lib/work/load-counts.ts.
import { z } from 'zod';

import { orderSchema } from './order';
import { quoteSchema } from './quote';

export const QUEUE_SORTS = ['oldest', 'newest'] as const;

export type QueueSort = (typeof QUEUE_SORTS)[number];

export const QUEUE_LIMIT_MAX = 200;

export interface CountAndOldest<T> {
  count: number;
  oldest: T | null;
}

export function queueCountResponseSchema<T extends z.ZodType>(oldest: T) {
  return z.object({
    count: z.number().int().nonnegative(),
    oldest: oldest.nullable(),
  });
}

export const quoteCountOldestSchema = quoteSchema.pick({
  id: true,
  quoteNumber: true,
  versionNumber: true,
  customerId: true,
  status: true,
  updatedAt: true,
});

export type QuoteCountOldest = z.infer<typeof quoteCountOldestSchema>;

export const quoteCountResponseSchema = queueCountResponseSchema(quoteCountOldestSchema);

export type QuoteCountResponse = z.infer<typeof quoteCountResponseSchema>;

export const orderCountOldestSchema = orderSchema.pick({
  id: true,
  jobNumber: true,
  quoteId: true,
  customerId: true,
  status: true,
  updatedAt: true,
});

export type OrderCountOldest = z.infer<typeof orderCountOldestSchema>;

export const orderCountResponseSchema = queueCountResponseSchema(orderCountOldestSchema);

export type OrderCountResponse = z.infer<typeof orderCountResponseSchema>;
