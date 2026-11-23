// Tests token generation, hashing and the two expiry limits in modules/identity/src/domain/session.ts.
import { describe, expect, it } from 'vitest';

import {
  generateSessionToken,
  hashSessionToken,
  isSessionExpired,
  sessionExpiresAt,
  type SessionPolicy,
} from '../src/domain/session';
import type { SessionRecord } from '../src/ports';

const POLICY: SessionPolicy = {
  idleTimeoutMs: 60 * 60 * 1000,
  absoluteLifetimeMs: 4 * 60 * 60 * 1000,
};

const ISSUED = new Date('2026-07-29T08:00:00.000Z');

function session(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id: 'session-1',
    tokenHash: 'hash',
    userId: 'user-1',
    issuedAt: ISSUED,
    lastSeenAt: ISSUED,
    absoluteExpiresAt: new Date(ISSUED.getTime() + POLICY.absoluteLifetimeMs),
    ...overrides,
  };
}

function at(msFromIssue: number): Date {
  return new Date(ISSUED.getTime() + msFromIssue);
}

describe('generateSessionToken', () => {
  it('produces a distinct, URL-safe, high-entropy token each call', () => {
    const tokens = new Set(Array.from({ length: 100 }, () => generateSessionToken()));
    expect(tokens.size).toBe(100);
    for (const token of tokens) {
      expect(token).toMatch(/^[A-Za-z0-9_-]+$/);

      expect(token).toHaveLength(43);
    }
  });
});

describe('hashSessionToken', () => {
  it('is deterministic and never returns the token itself', () => {
    const token = generateSessionToken();
    expect(hashSessionToken(token)).toBe(hashSessionToken(token));
    expect(hashSessionToken(token)).not.toBe(token);
    expect(hashSessionToken(token)).toMatch(/^[a-f0-9]{64}$/);
  });

  it('separates distinct tokens', () => {
    expect(hashSessionToken('a')).not.toBe(hashSessionToken('b'));
  });
});

describe('sessionExpiresAt', () => {
  it('uses the idle deadline while it is the earlier bound', () => {
    expect(sessionExpiresAt(session(), POLICY)).toEqual(at(POLICY.idleTimeoutMs));
  });

  it('is capped by the absolute ceiling no matter how recently seen', () => {
    const lastSeenAt = at(POLICY.absoluteLifetimeMs - 10 * 60 * 1000);
    expect(sessionExpiresAt(session({ lastSeenAt }), POLICY)).toEqual(
      at(POLICY.absoluteLifetimeMs),
    );
  });
});

describe('isSessionExpired', () => {
  it('is live just before the idle deadline and expired at it', () => {
    expect(isSessionExpired(session(), POLICY, at(POLICY.idleTimeoutMs - 1))).toBe(false);
    expect(isSessionExpired(session(), POLICY, at(POLICY.idleTimeoutMs))).toBe(true);
  });

  it('expires at the absolute ceiling even when continuously active', () => {
    const lastSeenAt = at(POLICY.absoluteLifetimeMs - 1000);
    expect(isSessionExpired(session({ lastSeenAt }), POLICY, at(POLICY.absoluteLifetimeMs))).toBe(
      true,
    );
  });
});
