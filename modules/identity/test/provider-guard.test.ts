// Tests modules/identity/src/domain/provider-guard.ts, including the refusal of the local provider in
// production.
import { describe, expect, it } from 'vitest';

import { resolveAuthProviderName } from '../src/domain/provider-guard';

describe('resolveAuthProviderName', () => {
  it('accepts ldap in any environment', () => {
    expect(resolveAuthProviderName('ldap', 'production')).toBe('ldap');
    expect(resolveAuthProviderName('ldap', 'development')).toBe('ldap');
  });

  it('accepts local outside production', () => {
    expect(resolveAuthProviderName('local', 'development')).toBe('local');
    expect(resolveAuthProviderName('local', 'test')).toBe('local');
    expect(resolveAuthProviderName('local', undefined)).toBe('local');
  });

  it('refuses local in production at boot', () => {
    expect(() => resolveAuthProviderName('local', 'production')).toThrow(/development-only/);
  });

  it.each([
    ['an unset provider', undefined],
    ['an empty provider', ''],
    ['an unknown provider', 'oidc'],
  ])('rejects %s', (_label, raw) => {
    expect(() => resolveAuthProviderName(raw, 'development')).toThrow(/AUTH_PROVIDER/);
  });
});
