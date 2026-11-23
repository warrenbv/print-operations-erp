// Tests the local provider's start-up checks in modules/identity/src/domain/local-auth-config.ts.
import { describe, expect, it } from 'vitest';

import { resolveLocalAuthPassword, resolveLocalAuthRoster } from '../src/domain/local-auth-config';

describe('resolveLocalAuthPassword', () => {
  it('returns the configured password unchanged', () => {
    expect(resolveLocalAuthPassword('example password ')).toBe('example password ');
  });

  it.each([
    ['unset', undefined],
    ['empty', ''],
  ])('refuses a password that is %s instead of falling back to a built-in one', (_label, raw) => {
    expect(() => resolveLocalAuthPassword(raw)).toThrow(/LOCAL_AUTH_PASSWORD is not set/);
  });
});

describe('resolveLocalAuthRoster', () => {
  it('returns the listed accounts, normalized, in order', () => {
    expect(resolveLocalAuthRoster(' DEV-Sales , dev-admin,')).toEqual(['dev-sales', 'dev-admin']);
  });

  it.each([
    ['unset', undefined],
    ['empty', ''],
    ['blank', ' , '],
  ])('refuses a roster that is %s', (_label, raw) => {
    expect(() => resolveLocalAuthRoster(raw)).toThrow(/LOCAL_AUTH_USERS/);
  });

  it('refuses an account the local provider does not have', () => {
    expect(() => resolveLocalAuthRoster('dev-sales,break-glass')).toThrow(/break-glass/);
  });

  it('refuses an account listed twice', () => {
    expect(() => resolveLocalAuthRoster('dev-sales,DEV-SALES')).toThrow(/twice/);
  });
});
