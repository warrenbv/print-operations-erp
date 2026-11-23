// The directory search behind the Admin page, used by modules/identity/src/admin-role-service.ts.
// Unlike sign-in, an unreachable directory is thrown as `LdapUnreachableError` for the API to report.
// The local counterpart is modules/identity/src/providers/local-directory.ts.
import type { LdapConfig } from '../domain/ldap-config';
import { escapeLdapFilterValue } from '../domain/ldap-filter';
import { normalizeUsername } from '../domain/username';
import {
  LdapUnreachableError,
  type LdapClient,
  type LdapClientFactory,
  type LdapUserEntry,
} from './ldap-client';

export interface LdapDirectoryUser {
  externalId: string;

  username: string;
  displayName: string;
  email?: string;

  disabled: boolean;
}

export interface LdapDirectory {
  searchUsers(query: string, limit: number): Promise<readonly LdapDirectoryUser[]>;
}

const ACCOUNTDISABLE = 0x0002;

export class LdaptsLdapDirectory implements LdapDirectory {
  readonly #config: LdapConfig;
  readonly #factory: LdapClientFactory;

  constructor(config: LdapConfig, factory: LdapClientFactory) {
    this.#config = config;
    this.#factory = factory;
  }

  async searchUsers(query: string, limit: number): Promise<readonly LdapDirectoryUser[]> {
    const filter = buildSearchFilter(query);
    const client = await this.#connectAndBindService();
    try {
      const entries = await client.search(this.#config.userBaseDn, filter);
      // The limit is applied to what the directory returns, not sent with the search.
      return entries.slice(0, limit).map(toDirectoryUser);
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
        errors.push(err instanceof Error ? err : new Error(String(err)));
      }
    }
    throw new LdapUnreachableError(
      `all LDAP endpoints unreachable: ${errors.map((e) => e.message).join('; ')}`,
    );
  }
}

const USER_OBJECT = '(objectCategory=person)(objectClass=user)';

/** People only. An empty query lists everyone with an account name. Others match name, display name or mail. */
export function buildSearchFilter(query: string): string {
  const trimmed = query.trim();
  if (trimmed === '') {
    return `(&${USER_OBJECT}(sAMAccountName=*))`;
  }
  const escaped = escapeLdapFilterValue(trimmed);
  return `(&${USER_OBJECT}(|(sAMAccountName=*${escaped}*)(displayName=*${escaped}*)(mail=*${escaped}*)))`;
}

function toDirectoryUser(entry: LdapUserEntry): LdapDirectoryUser {
  const username = normalizeUsername(entry.sAMAccountName);
  return {
    externalId: entry.objectGuid,
    username,
    displayName: entry.displayName || username,
    ...(entry.mail === undefined ? {} : { email: entry.mail }),
    disabled: (entry.userAccountControl & ACCOUNTDISABLE) !== 0,
  };
}
