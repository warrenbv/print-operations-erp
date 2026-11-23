// Decides at start-up whether the local accounts get their roles seeded by
// modules/identity/src/dev-role-seed.ts. Called from apps/api/src/auth/auth.factory.ts.
import type { PersistenceMode } from '@erp/types';
import type { AuthProviderName } from './provider-guard';

/**
 * False when `DEV_SEED_ROLES` is unset or empty. True only for the exact value `true` with the local
 * provider, in-memory storage and a `NODE_ENV` other than `production`. Throws for any other value,
 * and for `true` under any other combination, so the API refuses to start instead of ignoring the flag.
 */
export function resolveDevRoleSeeding(
  rawFlag: string | undefined,
  provider: AuthProviderName,
  persistence: PersistenceMode,
  nodeEnv: string | undefined,
): boolean {
  if (rawFlag === undefined || rawFlag === '') {
    return false;
  }
  if (rawFlag !== 'true') {
    throw new Error(
      `DEV_SEED_ROLES "${rawFlag}" is not valid — set it to "true" or leave it unset`,
    );
  }

  if (nodeEnv === 'production') {
    throw new Error(refusal('NODE_ENV is "production"'));
  }
  if (provider !== 'local') {
    throw new Error(refusal(`AUTH_PROVIDER is "${provider}"`));
  }
  if (persistence !== 'memory') {
    throw new Error(refusal(`DATA_PERSISTENCE is "${persistence}"`));
  }
  return true;
}

function refusal(cause: string): string {
  return (
    `DEV_SEED_ROLES is "true" but ${cause}. Dev role seeding runs only with ` +
    'AUTH_PROVIDER="local" and DATA_PERSISTENCE="memory", outside production: ' +
    'it grants roles to accounts nobody can authenticate as anywhere else, and ' +
    'Postgres would keep them.'
  );
}
