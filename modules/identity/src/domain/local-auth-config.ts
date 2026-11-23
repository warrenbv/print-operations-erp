// Start-up checks for the local provider's two settings. The local provider has no built-in password
// and no default roster, so both must be set or the API does not start.
// Called from apps/api/src/auth/auth.factory.ts and apps/api/src/admin/admin.factory.ts.
import { DEV_USERNAMES, type DevUsername } from '../providers/local-auth-provider';
import { normalizeUsername } from './username';

export function resolveLocalAuthPassword(raw: string | undefined): string {
  if (raw === undefined || raw === '') {
    throw new Error(
      'AUTH_PROVIDER is "local" but LOCAL_AUTH_PASSWORD is not set. ' +
        'The local provider has no built-in password, so the api will not start.',
    );
  }
  return raw;
}

/**
 * The accounts `LOCAL_AUTH_USERS` allows to sign in, normalised. Throws when the list is empty, names
 * an account outside `DEV_USERNAMES`, or names one twice.
 */
export function resolveLocalAuthRoster(raw: string | undefined): readonly DevUsername[] {
  const names = (raw ?? '')
    .split(',')
    .map(normalizeUsername)
    .filter((name) => name !== '');
  if (names.length === 0) {
    throw new Error(
      'AUTH_PROVIDER is "local" but LOCAL_AUTH_USERS is not set. ' +
        `List the accounts it may sign in, separated by commas, from: ${DEV_USERNAMES.join(', ')}.`,
    );
  }
  const unknown = names.filter((name) => !(DEV_USERNAMES as readonly string[]).includes(name));
  if (unknown.length > 0) {
    throw new Error(
      `LOCAL_AUTH_USERS names accounts the local provider does not have: ${unknown.join(', ')}. ` +
        `Choose from: ${DEV_USERNAMES.join(', ')}.`,
    );
  }
  const repeated = names.filter((name, index) => names.indexOf(name) !== index);
  if (repeated.length > 0) {
    throw new Error(
      `LOCAL_AUTH_USERS lists an account twice: ${[...new Set(repeated)].join(', ')}.`,
    );
  }
  return names as DevUsername[];
}
