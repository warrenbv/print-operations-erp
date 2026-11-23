// Tests the Admin page's directory search in modules/identity/src/providers/ldap-directory.ts against a
// scripted LDAP client.
import { describe, expect, it } from 'vitest';

import type { LdapConfig } from '../src/domain/ldap-config';
import {
  LdapUnreachableError,
  type LdapClient,
  type LdapClientFactory,
  type LdapUserEntry,
} from '../src/providers/ldap-client';
import { LdaptsLdapDirectory, buildSearchFilter } from '../src/providers/ldap-directory';

const USER_OBJECT = '(objectCategory=person)(objectClass=user)';

function config(): LdapConfig {
  return {
    urls: ['ldaps://dc1:636'],
    bindDn: 'CN=directory-reader,DC=demo',
    bindPassword: 'service-pw',
    userBaseDn: 'DC=demo',
    caCertificate: Buffer.from('ca'),
    timeoutMs: 3000,
  };
}

function anEntry(overrides: Partial<LdapUserEntry> = {}): LdapUserEntry {
  return {
    dn: 'CN=Alex Example,OU=People,DC=demo',
    objectGuid: '7c3e91d04a5bf268e1d93a07c5b84f62',
    sAMAccountName: 'jane.doe',
    displayName: 'Alex Example',
    mail: 'jane.doe@corp.example',
    userAccountControl: 0x0200,
    ...overrides,
  } as LdapUserEntry;
}

function directoryOf(entries: readonly LdapUserEntry[]): {
  factory: LdapClientFactory;
  searchCalls: Array<{ baseDn: string; filter: string }>;
} {
  const searchCalls: Array<{ baseDn: string; filter: string }> = [];
  const client: LdapClient = {
    bind: async () => {},
    search: async (baseDn, filter) => {
      searchCalls.push({ baseDn, filter });
      return entries;
    },
    unbind: async () => {},
  };
  const factory: LdapClientFactory = async () => client;
  return { factory, searchCalls };
}

describe('buildSearchFilter', () => {
  it('restricts an empty query to user objects, not everything with a sAMAccountName', () => {
    expect(buildSearchFilter('')).toBe(`(&${USER_OBJECT}(sAMAccountName=*))`);
    expect(buildSearchFilter('   ')).toBe(`(&${USER_OBJECT}(sAMAccountName=*))`);
  });

  it('restricts a substring query to user objects as well', () => {
    expect(buildSearchFilter('jane')).toBe(
      `(&${USER_OBJECT}(|(sAMAccountName=*jane*)(displayName=*jane*)(mail=*jane*)))`,
    );
  });

  it('still escapes the query inside the user-object predicate', () => {
    expect(buildSearchFilter('a)(objectClass=*')).toBe(
      `(&${USER_OBJECT}(|(sAMAccountName=*a\\29\\28objectClass=\\2a*)(displayName=*a\\29\\28objectClass=\\2a*)(mail=*a\\29\\28objectClass=\\2a*)))`,
    );
  });
});

describe('LdaptsLdapDirectory.searchUsers', () => {
  it('sends the user-object filter against the configured base DN', async () => {
    const { factory, searchCalls } = directoryOf([anEntry()]);
    const directory = new LdaptsLdapDirectory(config(), factory);

    await directory.searchUsers('', 50);

    expect(searchCalls).toEqual([
      { baseDn: 'DC=demo', filter: `(&${USER_OBJECT}(sAMAccountName=*))` },
    ]);
  });

  it('builds a row for a user with no mail and no display name', async () => {
    const { factory } = directoryOf([
      anEntry({ sAMAccountName: 'backup-agent', displayName: '', mail: undefined }),
    ]);
    const directory = new LdaptsLdapDirectory(config(), factory);

    const [row] = await directory.searchUsers('', 50);

    expect(row).toEqual({
      externalId: '7c3e91d04a5bf268e1d93a07c5b84f62',
      username: 'backup-agent',
      displayName: 'backup-agent',
      disabled: false,
    });
    expect(row).not.toHaveProperty('email');
  });

  it('caps the result at the caller limit', async () => {
    const { factory } = directoryOf([
      anEntry({ objectGuid: '01' }),
      anEntry({ objectGuid: '02' }),
      anEntry({ objectGuid: '03' }),
    ]);
    const directory = new LdaptsLdapDirectory(config(), factory);

    const rows = await directory.searchUsers('', 2);

    expect(rows.map((r) => r.externalId)).toEqual(['01', '02']);
  });

  it('fails closed when no endpoint accepts the service bind', async () => {
    const factory: LdapClientFactory = async () => {
      throw new LdapUnreachableError('connection refused');
    };
    const directory = new LdaptsLdapDirectory(config(), factory);

    await expect(directory.searchUsers('', 50)).rejects.toBeInstanceOf(LdapUnreachableError);
  });
});
