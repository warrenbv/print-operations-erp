// Tests for the health endpoint's payload schema.
import { describe, expect, it } from 'vitest';

import { healthPayloadSchema, type HealthPayload } from '../src/health';

const validPayload: HealthPayload = {
  status: 'ok',
  service: 'erp-api',
  version: '1.2.3',
  uptimeSeconds: 38.5,
  timestamp: '2026-07-28T18:30:00.000Z',
};

const invalidPayloads: Array<[string, unknown]> = [
  ['a status other than ok', { ...validPayload, status: 'degraded' }],
  ['an empty service name', { ...validPayload, service: '' }],
  ['an empty version', { ...validPayload, version: '' }],
  ['negative uptime', { ...validPayload, uptimeSeconds: -1 }],
  ['a non-ISO timestamp', { ...validPayload, timestamp: 'last tuesday' }],
  ['a missing field', { status: 'ok', service: 'erp-api' }],
];

describe('healthPayloadSchema', () => {
  it('accepts the payload the API returns', () => {
    expect(healthPayloadSchema.parse(validPayload)).toEqual(validPayload);
  });

  it.each(invalidPayloads)('rejects %s', (_label, payload) => {
    expect(healthPayloadSchema.safeParse(payload).success).toBe(false);
  });
});
