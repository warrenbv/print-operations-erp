// The reply of the API's health endpoint: apps/api/src/health/health.controller.ts.
import { z } from 'zod';

export const healthPayloadSchema = z.object({
  status: z.literal('ok'),
  service: z.string().min(1),
  version: z.string().min(1),
  uptimeSeconds: z.number().nonnegative(),
  timestamp: z.iso.datetime(),
});

export type HealthPayload = z.infer<typeof healthPayloadSchema>;
