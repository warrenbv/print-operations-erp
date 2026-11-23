// Sign-in against the company directory over LDAPS: docs/decisions/009-technology-stack.md. A service
// bind finds the user's entry, then a second connection binds as that entry with the password typed.
// The directory proves who someone is. Roles stay in the ERP. Settings come from
// modules/identity/src/domain/ldap-config.ts.
import type { AuthProvider, AuthResult } from '@erp/types';

import type { LdapConfig } from '../domain/ldap-config';
import { escapeLdapFilterValue } from '../domain/ldap-filter';
import { normalizeUsername } from '../domain/username';
import {
  LdapInvalidCredentialsError,
  LdapUnreachableError,
  type LdapClient,
  type LdapClientFactory,
  type LdapUserEntry,
} from './ldap-client';

// The `userAccountControl` bit a disabled directory account carries.
const ACCOUNTDISABLE = 0x0002;

export class LdapAuthProvider implements AuthProvider {
  readonly #config: LdapConfig;
  readonly #factory: LdapClientFactory;

  constructor(config: LdapConfig, factory: LdapClientFactory) {
    this.#config = config;
    this.#factory = factory;
  }

  async authenticate(rawUsername: string, password: string): Promise<AuthResult> {
    const username = normalizeUsername(rawUsername);
    const filter = buildUserFilter(username);

    return this.#withServiceBind(async (client) => {
      const entries = await client.search(this.#config.userBaseDn, filter);
      if (entries.length === 0) {
        return { ok: false, reason: 'invalid-credentials' };
      }
      // With more than one match the first entry is used. `ldap:probe` reports such a filter as ambiguous.
      const entry = entries[0];
      if (entry === undefined) {
        return { ok: false, reason: 'invalid-credentials' };
      }

      // A disabled account gets the same answer as an unknown user or a wrong password.
      if ((entry.userAccountControl & ACCOUNTDISABLE) !== 0) {
        return { ok: false, reason: 'invalid-credentials' };
      }

      // The account name is the stored username, so an entry without one gets the same answer.
      const accountName = normalizeUsername(entry.sAMAccountName);
      if (accountName === '') {
        return { ok: false, reason: 'invalid-credentials' };
      }

      const userClient = await this.#connectFirstReachable();
      try {
        await userClient.bind(entry.dn, password);
      } catch (err) {
        if (err instanceof LdapInvalidCredentialsError) {
          return { ok: false, reason: 'invalid-credentials' };
        }

        // Any other bind failure is treated as the directory being unavailable, not as a wrong password.
        return { ok: false, reason: 'directory-unreachable' };
      } finally {
        await userClient.unbind();
      }

      return { ok: true, identity: toVerifiedIdentity(entry, accountName) };
    });
  }

  // Every failure to bind the service account, including the directory rejecting its own credentials,
  // reaches the person signing in as `directory-unreachable`. The `ldap:probe` tool tells them apart:
  // modules/identity/src/cli/ldap-probe.ts.
  async #withServiceBind<T extends AuthResult>(
    op: (client: LdapClient) => Promise<T>,
  ): Promise<AuthResult> {
    let client: LdapClient;
    try {
      client = await this.#connectAndBindService();
    } catch (err) {
      if (err instanceof LdapUnreachableError) {
        return { ok: false, reason: 'directory-unreachable' };
      }

      return { ok: false, reason: 'directory-unreachable' };
    }
    try {
      return await op(client);
    } catch (err) {
      if (err instanceof LdapUnreachableError) {
        return { ok: false, reason: 'directory-unreachable' };
      }
      throw err;
    } finally {
      await client.unbind();
    }
  }

  async #connectAndBindService(): Promise<LdapClient> {
    const errors: Error[] = [];
    for (const url of this.#config.urls) {
      let client: LdapClient;
      try {
        client = await this.#factory(url);
      } catch (err) {
        errors.push(err instanceof Error ? err : new Error(String(err)));
        continue;
      }
      try {
        await client.bind(this.#config.bindDn, this.#config.bindPassword);
        return client;
      } catch (err) {
        await client.unbind();
        // A rejected service password stops the search. Only a failure to connect or bind for another
        // reason moves on to the next endpoint.
        if (err instanceof LdapInvalidCredentialsError) {
          throw err;
        }
        errors.push(err instanceof Error ? err : new Error(String(err)));
      }
    }
    throw new LdapUnreachableError(
      `all LDAP endpoints unreachable: ${errors.map((e) => e.message).join('; ')}`,
    );
  }

  async #connectFirstReachable(): Promise<LdapClient> {
    const errors: Error[] = [];
    for (const url of this.#config.urls) {
      try {
        return await this.#factory(url);
      } catch (err) {
        errors.push(err instanceof Error ? err : new Error(String(err)));
      }
    }
    throw new LdapUnreachableError(
      `all LDAP endpoints unreachable: ${errors.map((e) => e.message).join('; ')}`,
    );
  }
}

/** Matches the escaped username against either sign-in name. Exported for the probe. */
export function buildUserFilter(username: string): string {
  const escaped = escapeLdapFilterValue(username);
  return `(|(sAMAccountName=${escaped})(userPrincipalName=${escaped}))`;
}

// The user record is keyed by the entry's objectGUID. Its username is the entry's account name, never the name
// typed, so both sign-in names of one account leave one username. apps/api/src/auth/roles.guard.ts matches
// READ_ONLY_USERS against it.
function toVerifiedIdentity(
  entry: LdapUserEntry,
  accountName: string,
): { externalId: string; username: string; displayName: string; email?: string } {
  return {
    externalId: entry.objectGuid,
    username: accountName,
    displayName: entry.displayName || accountName,
    ...(entry.mail === undefined ? {} : { email: entry.mail }),
  };
}
