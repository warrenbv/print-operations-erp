// `WEB_ORIGIN` is read once at start, by apps/api/src/config/origin-check.ts through
// apps/api/src/config/request-parsing.ts. A value that is not exactly an origin as a browser sends it stops the start,
// because it would refuse every browser write or, as `null`, admit pages with no origin of their own.
import type { INestApplication } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import { configuredWebOrigin } from '../src/config/origin-check';
import { applyRequestParsing } from '../src/config/request-parsing';

const REFUSAL = /WEB_ORIGIN/;

describe('configuredWebOrigin', () => {
  it.each([undefined, ''])('allows no browser origin when the setting is %j', (value) => {
    expect(configuredWebOrigin({ WEB_ORIGIN: value })).toBeUndefined();
  });

  it.each([
    'http://127.0.0.1:4350',
    'https://erp.example.test',
    'http://erp.example.test:4100',
    'http://[::1]:4350',
  ])('accepts %s as it is', (value) => {
    expect(configuredWebOrigin({ WEB_ORIGIN: value })).toBe(value);
  });

  it.each([
    ['a trailing slash', 'https://erp.example.test/'],
    ['capitals', 'https://ERP.example.test'],
    ['a path', 'https://erp.example.test/app'],
    ['the default port written out', 'https://erp.example.test:443'],
    ['the literal null', 'null'],
    ['a wildcard', '*'],
    ['a bare host', 'erp.example.test'],
    ['surrounding space', ' https://erp.example.test'],
    ['two origins', 'https://erp.example.test,https://other.example.test'],
    ['a WebSocket scheme', 'ws://erp.example.test'],
    ['a file transfer scheme', 'ftp://erp.example.test'],
    ['port 0', 'https://erp.example.test:0'],
  ])('stops the start on %s', (_label, value) => {
    expect(() => configuredWebOrigin({ WEB_ORIGIN: value })).toThrow(REFUSAL);
  });
});

describe('applyRequestParsing, which every way the API is built calls', () => {
  // Only the parts of a Nest application that applyRequestParsing touches.
  const app = {
    getHttpAdapter: () => ({ getInstance: () => ({ set: () => undefined }) }),
    use: () => undefined,
  } as unknown as INestApplication;

  it('throws on a WEB_ORIGIN that is not an origin', () => {
    const before = process.env.WEB_ORIGIN;
    process.env.WEB_ORIGIN = 'https://erp.example.test/';
    try {
      expect(() => applyRequestParsing(app)).toThrow(REFUSAL);
    } finally {
      if (before === undefined) {
        delete process.env.WEB_ORIGIN;
      } else {
        process.env.WEB_ORIGIN = before;
      }
    }
  });
});
