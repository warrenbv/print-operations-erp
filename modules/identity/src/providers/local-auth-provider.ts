// The sign-in provider for development and the demonstration: a fixed list of account names and one
// shared password from configuration. The guards in modules/identity/src/domain/provider-guard.ts and
// modules/identity/src/domain/local-auth-config.ts keep it out of production and stop the API without
// both settings. Roles come from modules/identity/src/dev-role-seed.ts, not from here.
import type { AuthProvider, AuthResult } from '@erp/types';

import { normalizeUsername } from '../domain/username';

export const DEV_USERNAMES = [
  'dev-sales',
  'dev-billing',
  'dev-production',

  'dev-production-manager',
  'dev-admin',

  'dev-noroles',
] as const;

export type DevUsername = (typeof DEV_USERNAMES)[number];

/** A reserved test domain, so mail addressed to these accounts cannot reach a real mailbox. */
export const DEV_EMAIL_DOMAIN = 'example.test';

export function devEmailFor(username: string): string {
  return `${normalizeUsername(username)}@${DEV_EMAIL_DOMAIN}`;
}

export class LocalAuthProvider implements AuthProvider {
  readonly #password: string;
  readonly #usernames: ReadonlySet<string>;

  // The API always passes the roster from `LOCAL_AUTH_USERS`. The default serves tests.
  constructor(password: string, usernames: readonly string[] = DEV_USERNAMES) {
    this.#password = password;
    this.#usernames = new Set(usernames.map(normalizeUsername));
  }

  async authenticate(username: string, password: string): Promise<AuthResult> {
    const normalized = normalizeUsername(username);
    if (!this.#usernames.has(normalized) || password !== this.#password) {
      return { ok: false, reason: 'invalid-credentials' };
    }
    return {
      ok: true,
      identity: {
        externalId: `local:${normalized}`,
        username: normalized,
        displayName: normalized,

        email: devEmailFor(normalized),
      },
    };
  }
}
