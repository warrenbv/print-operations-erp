// Tests modules/identity/src/adapters/ldapts-client.ts with the ldapts library mocked: the options a
// connection opens with, the objectGUID encoding and how absent or multi-valued attributes map to
// the port.
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createLdaptsClientFactory, ldaptsClientOptions } from '../src/adapters/ldapts-client';
import type { LdapConfig } from '../src/domain/ldap-config';

const search = vi.fn();
const bind = vi.fn();
const unbind = vi.fn();

vi.mock('ldapts', () => ({
  Client: class {
    bind = bind;
    search = search;
    unbind = unbind;
  },

  InvalidCredentialsError: class extends Error {},
}));

const config: LdapConfig = {
  urls: ['ldaps://dc1.corp.example:636'],
  bindDn: 'CN=directory-reader,DC=demo,DC=example',
  bindPassword: 'unit-test-only',
  userBaseDn: 'DC=demo,DC=example',
  caCertificate: Buffer.from('ca'),
  timeoutMs: 3000,
};

describe('ldaptsClientOptions', () => {
  const options = ldaptsClientOptions(config, 'ldaps://dc2.corp.example:636');

  it('connects to the URL it is given, with the configured timeout for both waits', () => {
    expect(options.url).toBe('ldaps://dc2.corp.example:636');
    expect(options.timeout).toBe(config.timeoutMs);
    expect(options.connectTimeout).toBe(config.timeoutMs);
  });

  it('trusts the configured CA and always verifies the directory certificate', () => {
    expect(options.tlsOptions).toEqual({ ca: config.caCertificate, rejectUnauthorized: true });
  });
});

const GUID_INVALID_UTF8 = Buffer.from([
  0xff, 0xfe, 0x5a, 0x13, 0x8c, 0x47, 0x2e, 0x91, 0x66, 0x0b, 0xd3, 0x74, 0x39, 0xa8, 0x1f, 0xc5,
]);

const GUID_VALID_UTF8 = Buffer.from('Kq7mRz2wPx4nBt9v', 'ascii');

function ldaptsWouldReturn(raw: Buffer, explicitBufferAttributes: string[]): Buffer | string {
  if (explicitBufferAttributes.includes('objectGUID')) return raw;
  try {
    return new TextDecoder('utf8', { fatal: true }).decode(raw);
  } catch {
    return raw;
  }
}

function directoryHolds(rawGuid: Buffer) {
  search.mockImplementation(
    (_baseDn: string, options: { explicitBufferAttributes?: string[] }) => ({
      searchEntries: [
        {
          dn: 'CN=Ada,DC=demo,DC=example',
          objectGUID: ldaptsWouldReturn(rawGuid, options.explicitBufferAttributes ?? []),
          displayName: 'Ada',
          userAccountControl: 0,
        },
      ],
    }),
  );
}

async function lookUp() {
  const client = await createLdaptsClientFactory(config)('ldaps://dc1.corp.example:636');
  return client.search('DC=demo,DC=example', '(sAMAccountName=ada)');
}

beforeEach(() => {
  search.mockReset();
  bind.mockReset();
  unbind.mockReset();
});

describe('LdaptsClient objectGUID encoding', () => {
  it('asks ldapts for objectGUID as a raw Buffer', async () => {
    directoryHolds(GUID_INVALID_UTF8);
    await lookUp();

    expect(search).toHaveBeenCalledTimes(1);
    expect(search.mock.calls[0]?.[1]).toMatchObject({ explicitBufferAttributes: ['objectGUID'] });
  });

  it('renders a non-UTF-8 GUID as lower-case hex', async () => {
    directoryHolds(GUID_INVALID_UTF8);
    const [found] = await lookUp();

    expect(found?.objectGuid).toBe('fffe5a138c472e91660bd37439a81fc5');
  });

  it('renders a GUID whose bytes decode cleanly as hex too, not as the decoded text', async () => {
    directoryHolds(GUID_VALID_UTF8);
    const [found] = await lookUp();

    expect(found?.objectGuid).toBe('4b71376d527a32775078346e42743976');
    expect(found?.objectGuid).not.toBe('Kq7mRz2wPx4nBt9v');
  });

  it('gives every GUID the same encoding regardless of its bytes', async () => {
    const widths = new Set<number>();
    for (const guid of [GUID_INVALID_UTF8, GUID_VALID_UTF8]) {
      directoryHolds(guid);
      const [found] = await lookUp();
      widths.add(found?.objectGuid.length ?? -1);
    }

    expect([...widths]).toEqual([32]);
  });

  it('refuses a decoded string rather than writing a second external_id encoding', async () => {
    search.mockResolvedValue({
      searchEntries: [
        {
          dn: 'CN=Ada,DC=demo,DC=example',
          objectGUID: 'Kq7mRz2wPx4nBt9v',
          displayName: 'Ada',
          userAccountControl: 0,
        },
      ],
    });

    await expect(lookUp()).rejects.toThrow(/explicitBufferAttributes/);
  });
});

describe('LdaptsClient absent and multi-valued attributes', () => {
  function mailboxLessUser() {
    search.mockResolvedValue({
      searchEntries: [
        {
          dn: 'CN=backup-agent,OU=Applications,DC=demo,DC=example',
          objectGUID: GUID_INVALID_UTF8,
          sAMAccountName: 'backup-agent',
          displayName: [],
          mail: [],
          userAccountControl: '66048',
        },
      ],
    });
  }

  it('maps a requested-but-absent attribute to the port shape, not to an empty array', async () => {
    mailboxLessUser();
    const [found] = await lookUp();

    expect(found?.displayName).toBe('');
    expect(found).not.toHaveProperty('mail');
    expect(found?.sAMAccountName).toBe('backup-agent');
  });

  it('still parses userAccountControl when it arrives as a string', async () => {
    mailboxLessUser();
    const [found] = await lookUp();

    expect(found?.userAccountControl).toBe(66048);
  });

  it('takes the first value of a multi-valued attribute', async () => {
    search.mockResolvedValue({
      searchEntries: [
        {
          dn: 'CN=Ada,DC=demo,DC=example',
          objectGUID: GUID_INVALID_UTF8,
          sAMAccountName: 'ada',
          displayName: 'Ada',
          mail: ['ada@corp.example', 'ada.lovelace@corp.example'],
          userAccountControl: 512,
        },
      ],
    });
    const [found] = await lookUp();

    expect(found?.mail).toBe('ada@corp.example');
  });

  it('treats an absent objectGUID as missing rather than rendering [] as hex', async () => {
    search.mockResolvedValue({
      searchEntries: [
        {
          dn: 'CN=Ada,DC=demo,DC=example',
          objectGUID: [],
          sAMAccountName: 'ada',
          displayName: 'Ada',
          userAccountControl: 512,
        },
      ],
    });

    await expect(lookUp()).rejects.toThrow(/missing objectGUID/);
  });
});
