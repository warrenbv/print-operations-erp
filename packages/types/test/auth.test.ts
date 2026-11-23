// Tests for the sign-in schemas: packages/types/src/auth.ts.
import { describe, expect, it } from 'vitest';

import {
  loginRequestSchema,
  verifiedIdentitySchema,
  type LoginRequest,
  type VerifiedIdentity,
} from '../src/auth';

const validIdentity: VerifiedIdentity = {
  externalId: '9a1f7e2c-3b4d-4c5e-8f60-1a2b3c4d5e6f',
  username: 'jdoe',
  displayName: 'A. Example',
  email: 'jdoe@example.test',
};

describe('loginRequestSchema', () => {
  it('normalizes the username and leaves the password alone', () => {
    const parsed: LoginRequest = loginRequestSchema.parse({
      username: '  JDoe ',
      password: '  s3cret! ',
    });
    expect(parsed.username).toBe('jdoe');
    expect(parsed.password).toBe('  s3cret! ');
  });

  it.each([
    ['an empty username', { username: '', password: 'x' }],
    ['a whitespace-only username', { username: '   ', password: 'x' }],
    ['an empty password', { username: 'jdoe', password: '' }],
    ['a missing password', { username: 'jdoe' }],
  ])('rejects %s', (_label, payload) => {
    expect(loginRequestSchema.safeParse(payload).success).toBe(false);
  });
});

describe('verifiedIdentitySchema', () => {
  it('accepts a verified identity, with email optional', () => {
    expect(verifiedIdentitySchema.parse(validIdentity)).toEqual(validIdentity);
    const withoutEmail: VerifiedIdentity = {
      externalId: validIdentity.externalId,
      username: validIdentity.username,
      displayName: validIdentity.displayName,
    };
    expect(verifiedIdentitySchema.parse(withoutEmail)).toEqual(withoutEmail);
  });

  it.each([
    ['an empty externalId', { ...validIdentity, externalId: '' }],
    ['an empty username', { ...validIdentity, username: '' }],
    ['an empty displayName', { ...validIdentity, displayName: '' }],
    ['a malformed email', { ...validIdentity, email: 'not-an-email' }],
  ])('rejects %s', (_label, payload) => {
    expect(verifiedIdentitySchema.safeParse(payload).success).toBe(false);
  });
});
