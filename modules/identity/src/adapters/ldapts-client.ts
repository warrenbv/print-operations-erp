// The `LdapClient` port over the ldapts library. Connections trust only the configured CA and use the
// configured timeout. A rejected bind becomes `LdapInvalidCredentialsError`. Every other library
// error becomes `LdapUnreachableError`. The port: modules/identity/src/providers/ldap-client.ts.
import { Client, InvalidCredentialsError } from 'ldapts';

import type { LdapConfig } from '../domain/ldap-config';
import {
  LdapInvalidCredentialsError,
  LdapUnreachableError,
  type LdapClient,
  type LdapClientFactory,
  type LdapUserEntry,
} from '../providers/ldap-client';

const SEARCH_ATTRIBUTES = [
  'objectGUID',
  'sAMAccountName',
  'displayName',
  'mail',
  'userAccountControl',
] as const;

// objectGUID is binary. Asking for raw bytes keeps one hex encoding for every user's external id.
const BUFFER_ATTRIBUTES = ['objectGUID'] as const;

/**
 * The options every directory connection opens with. The directory's certificate must chain to the
 * configured CA. `rejectUnauthorized` is set explicitly so that NODE_TLS_REJECT_UNAUTHORIZED cannot
 * turn verification off for the connection that carries the bind password.
 * modules/identity/test/ldapts-client.test.ts pins each option.
 */
export function ldaptsClientOptions(config: LdapConfig, url: string) {
  return {
    url,
    timeout: config.timeoutMs,
    connectTimeout: config.timeoutMs,
    tlsOptions: {
      ca: config.caCertificate,
      rejectUnauthorized: true,
    },
  };
}

export function createLdaptsClientFactory(config: LdapConfig): LdapClientFactory {
  return async (url: string): Promise<LdapClient> => {
    const client = new Client(ldaptsClientOptions(config, url));
    return new LdaptsClient(client);
  };
}

class LdaptsClient implements LdapClient {
  readonly #client: Client;

  constructor(client: Client) {
    this.#client = client;
  }

  async bind(dn: string, password: string): Promise<void> {
    try {
      await this.#client.bind(dn, password);
    } catch (err) {
      if (err instanceof InvalidCredentialsError) {
        throw new LdapInvalidCredentialsError();
      }

      throw new LdapUnreachableError(err instanceof Error ? err.message : String(err));
    }
  }

  async search(baseDn: string, filter: string): Promise<readonly LdapUserEntry[]> {
    try {
      const result = await this.#client.search(baseDn, {
        filter,
        scope: 'sub',
        attributes: SEARCH_ATTRIBUTES as unknown as string[],

        explicitBufferAttributes: [...BUFFER_ATTRIBUTES],
      });
      return result.searchEntries.map(mapEntry);
    } catch (err) {
      throw new LdapUnreachableError(err instanceof Error ? err.message : String(err));
    }
  }

  async unbind(): Promise<void> {
    try {
      await this.#client.unbind();
      // Callers unbind in `finally` blocks. A failed unbind must not hide the real outcome.
    } catch {}
  }
}

type RawValue<T> = T | T[] | undefined;

interface RawEntry {
  dn: string;
  objectGUID?: RawValue<Buffer | string>;
  sAMAccountName?: RawValue<string>;
  displayName?: RawValue<string>;
  mail?: RawValue<string>;
  userAccountControl?: RawValue<string | number>;
}

function single<T>(value: RawValue<T>): T | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function mapEntry(raw: unknown): LdapUserEntry {
  const entry = raw as RawEntry;
  const objectGuid = normalizeObjectGuid(single(entry.objectGUID));
  const mail = single(entry.mail);
  const userAccountControl = single(entry.userAccountControl);
  return {
    dn: entry.dn,
    objectGuid,

    sAMAccountName: single(entry.sAMAccountName) ?? '',
    displayName: single(entry.displayName) ?? '',
    ...(mail === undefined ? {} : { mail }),
    userAccountControl:
      typeof userAccountControl === 'string'
        ? Number.parseInt(userAccountControl, 10)
        : (userAccountControl ?? 0),
  };
}

// Both refusals below reach callers as `LdapUnreachableError`, because `search` wraps every error it
// catches. Either way the entry yields no user record.
function normalizeObjectGuid(value: Buffer | string | undefined): string {
  if (value === undefined) {
    throw new LdapInvalidCredentialsError('user entry missing objectGUID');
  }
  if (typeof value === 'string') {
    throw new LdapUnreachableError(
      'objectGUID came back as a decoded string, not a Buffer — the ' +
        'explicitBufferAttributes guarantee in search() is broken. Refusing to ' +
        'write a second external_id encoding.',
    );
  }
  return value.toString('hex');
}
