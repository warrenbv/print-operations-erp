// Tests modules/identity/src/providers/ldap-auth-provider.ts against a scripted LDAP client: lookup,
// user bind, disabled accounts, endpoint failover and how each failure is reported.
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { LdapConfig } from '../src/domain/ldap-config';
import { LdapAuthProvider } from '../src/providers/ldap-auth-provider';
import {
  LdapInvalidCredentialsError,
  LdapUnreachableError,
  type LdapClient,
  type LdapClientFactory,
  type LdapUserEntry,
} from '../src/providers/ldap-client';

function baseConfig(overrides: Partial<LdapConfig> = {}): LdapConfig {
  return {
    urls: ['ldaps://dc1:636', 'ldaps://dc2:636'],
    bindDn: 'CN=directory-reader,DC=demo',
    bindPassword: 'service-pw',
    userBaseDn: 'OU=People,DC=demo',
    caCertificate: Buffer.from('ca'),
    timeoutMs: 3000,
    ...overrides,
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

interface Script {
  bind?: (dn: string, password: string) => Promise<void>;
  search?: (baseDn: string, filter: string) => Promise<readonly LdapUserEntry[]>;
}

function factory(scripts: readonly (Script | null)[]): {
  factory: LdapClientFactory;
  bindCalls: Array<{ dn: string; password: string }>;
  searchCalls: Array<{ baseDn: string; filter: string }>;
} {
  const bindCalls: Array<{ dn: string; password: string }> = [];
  const searchCalls: Array<{ baseDn: string; filter: string }> = [];
  let index = 0;
  const f: LdapClientFactory = async () => {
    const script = scripts[index++];
    if (script === undefined) {
      throw new LdapUnreachableError('script exhausted');
    }
    if (script === null) {
      throw new LdapUnreachableError('connection refused');
    }
    const client: LdapClient = {
      bind: async (dn, password) => {
        bindCalls.push({ dn, password });
        if (script.bind === undefined) {
          throw new Error('bind not scripted');
        }
        await script.bind(dn, password);
      },
      search: async (baseDn, filter) => {
        searchCalls.push({ baseDn, filter });
        if (script.search === undefined) {
          throw new Error('search not scripted');
        }
        return script.search(baseDn, filter);
      },
      unbind: async () => {},
    };
    return client;
  };
  return { factory: f, bindCalls, searchCalls };
}

describe('LdapAuthProvider', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('happy path: service bind + search + user bind produces a VerifiedIdentity named by the entry', async () => {
    const {
      factory: f,
      bindCalls,
      searchCalls,
    } = factory([
      {
        bind: async () => {},
        search: async () => [anEntry()],
      },

      {
        bind: async () => {},
      },
    ]);
    const provider = new LdapAuthProvider(baseConfig(), f);

    const result = await provider.authenticate('  JDoe  ', 'user-pw');

    expect(result).toEqual({
      ok: true,
      identity: {
        externalId: '7c3e91d04a5bf268e1d93a07c5b84f62',
        username: 'jane.doe',
        displayName: 'Alex Example',
        email: 'jane.doe@corp.example',
      },
    });

    expect(bindCalls).toEqual([
      { dn: 'CN=directory-reader,DC=demo', password: 'service-pw' },
      { dn: 'CN=Alex Example,OU=People,DC=demo', password: 'user-pw' },
    ]);

    expect(searchCalls).toEqual([
      {
        baseDn: 'OU=People,DC=demo',
        filter: '(|(sAMAccountName=jdoe)(userPrincipalName=jdoe))',
      },
    ]);
  });

  it('unknown user returns invalid-credentials (uniform failure — no enumeration)', async () => {
    const { factory: f } = factory([
      {
        bind: async () => {},
        search: async () => [],
      },
    ]);
    const result = await new LdapAuthProvider(baseConfig(), f).authenticate('nobody', 'x');
    expect(result).toEqual({ ok: false, reason: 'invalid-credentials' });
  });

  it('wrong password returns invalid-credentials', async () => {
    const { factory: f } = factory([
      {
        bind: async () => {},
        search: async () => [anEntry()],
      },
      {
        bind: async () => {
          throw new LdapInvalidCredentialsError();
        },
      },
    ]);
    const result = await new LdapAuthProvider(baseConfig(), f).authenticate('jdoe', 'wrong');
    expect(result).toEqual({ ok: false, reason: 'invalid-credentials' });
  });

  it('disabled account (userAccountControl 0x0002) returns invalid-credentials without attempting the user bind', async () => {
    const { factory: f, bindCalls } = factory([
      {
        bind: async () => {},
        search: async () => [anEntry({ userAccountControl: 0x0202 })],
      },
    ]);
    const result = await new LdapAuthProvider(baseConfig(), f).authenticate('jdoe', 'right');
    expect(result).toEqual({ ok: false, reason: 'invalid-credentials' });

    expect(bindCalls).toEqual([{ dn: 'CN=directory-reader,DC=demo', password: 'service-pw' }]);
  });

  it('DC1 unreachable → falls over to DC2 for the service bind and the user bind', async () => {
    const { factory: f, bindCalls } = factory([
      null,
      {
        bind: async () => {},
        search: async () => [anEntry()],
      },
      null,
      {
        bind: async () => {},
      },
    ]);
    const result = await new LdapAuthProvider(baseConfig(), f).authenticate('jdoe', 'right');
    expect(result.ok).toBe(true);

    expect(bindCalls.length).toBe(2);
  });

  it('all DCs unreachable → directory-unreachable (fail closed)', async () => {
    const { factory: f } = factory([null, null]);
    const result = await new LdapAuthProvider(baseConfig(), f).authenticate('jdoe', 'x');
    expect(result).toEqual({ ok: false, reason: 'directory-unreachable' });
  });

  it('TLS / transport error during user bind → directory-unreachable, not invalid-credentials', async () => {
    const { factory: f } = factory([
      {
        bind: async () => {},
        search: async () => [anEntry()],
      },
      {
        bind: async () => {
          throw new LdapUnreachableError('CERT_HAS_EXPIRED');
        },
      },
    ]);
    const result = await new LdapAuthProvider(baseConfig(), f).authenticate('jdoe', 'right');
    expect(result).toEqual({ ok: false, reason: 'directory-unreachable' });
  });

  it('service-account credential rejected → directory-unreachable (ops problem, uniform to user)', async () => {
    const { factory: f } = factory([
      {
        bind: async () => {
          throw new LdapInvalidCredentialsError();
        },
      },
    ]);
    const result = await new LdapAuthProvider(
      baseConfig({ urls: ['ldaps://dc1:636'] }),
      f,
    ).authenticate('jdoe', 'x');
    expect(result).toEqual({ ok: false, reason: 'directory-unreachable' });
  });

  it('escapes the username in the filter — LDAP injection attempt has no effect', async () => {
    const { factory: f, searchCalls } = factory([
      {
        bind: async () => {},
        search: async () => [],
      },
    ]);
    await new LdapAuthProvider(baseConfig(), f).authenticate('foo)(objectClass=*', 'x');
    expect(searchCalls[0]?.filter).toBe(
      '(|(sAMAccountName=foo\\29\\28objectclass=\\2a)(userPrincipalName=foo\\29\\28objectclass=\\2a))',
    );
  });

  it('missing displayName falls back to the account name', async () => {
    const { factory: f } = factory([
      {
        bind: async () => {},
        search: async () => [anEntry({ displayName: '' })],
      },
      {
        bind: async () => {},
      },
    ]);
    const result = await new LdapAuthProvider(baseConfig(), f).authenticate('JDoe', 'right');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.identity.displayName).toBe('jane.doe');
    }
  });

  it.each([
    ['its account name', 'Robin.Ledger'],
    ['its principal name', 'robin.ledger@example.test'],
  ])(
    "names the user by the entry's account name when it signs in under %s",
    async (_label, typed) => {
      const { factory: f } = factory([
        {
          bind: async () => {},
          search: async () => [anEntry({ sAMAccountName: 'Robin.Ledger' })],
        },
        {
          bind: async () => {},
        },
      ]);
      const result = await new LdapAuthProvider(baseConfig(), f).authenticate(typed, 'right');
      expect(result.ok && result.identity.username).toBe('robin.ledger');
    },
  );

  it('refuses an entry with no account name as bad credentials, without the user bind', async () => {
    const { factory: f, bindCalls } = factory([
      {
        bind: async () => {},
        search: async () => [anEntry({ sAMAccountName: '' })],
      },
    ]);
    const result = await new LdapAuthProvider(baseConfig(), f).authenticate(
      'robin.ledger@example.test',
      'right',
    );
    expect(result).toEqual({ ok: false, reason: 'invalid-credentials' });
    expect(bindCalls).toEqual([{ dn: 'CN=directory-reader,DC=demo', password: 'service-pw' }]);
  });
});
