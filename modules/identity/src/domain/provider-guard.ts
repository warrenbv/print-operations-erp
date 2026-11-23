// Chooses the authentication provider from `AUTH_PROVIDER` at start-up. There is no default, and the
// local provider is refused outright when `NODE_ENV` is `production`.
// The two providers: modules/identity/src/providers/.
const AUTH_PROVIDERS = ['ldap', 'local'] as const;

export type AuthProviderName = (typeof AUTH_PROVIDERS)[number];

/**
 * Throws when `AUTH_PROVIDER` is unset, empty or not `ldap` or `local`, and when it is `local` while
 * `NODE_ENV` is `production`. The check reads `NODE_ENV` only, so any other value admits the local
 * provider.
 */
export function resolveAuthProviderName(
  rawProvider: string | undefined,
  nodeEnv: string | undefined,
): AuthProviderName {
  if (rawProvider === undefined || rawProvider === '') {
    throw new Error('AUTH_PROVIDER is not set (expected "ldap" or "local")');
  }
  if (!AUTH_PROVIDERS.includes(rawProvider as AuthProviderName)) {
    throw new Error(`AUTH_PROVIDER "${rawProvider}" is not one of: ${AUTH_PROVIDERS.join(', ')}`);
  }
  const provider = rawProvider as AuthProviderName;
  if (provider === 'local' && nodeEnv === 'production') {
    throw new Error('AUTH_PROVIDER "local" is development-only and refuses to run in production');
  }
  return provider;
}
