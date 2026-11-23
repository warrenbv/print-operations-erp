// Tests modules/identity/src/domain/ldap-config.ts: required settings, the ldaps-only rule, the CA file
// and the timeout.
import { describe, expect, it } from 'vitest';

import { resolveLdapConfig, type LdapEnv } from '../src/domain/ldap-config';

const CA_BYTES = Buffer.from('-----BEGIN CERTIFICATE-----\nfake\n-----END CERTIFICATE-----\n');
const readCa = (): Buffer => CA_BYTES;

function baseEnv(): LdapEnv {
  return {
    LDAP_URLS: 'ldaps://dc1.corp.example:636,ldaps://dc2.corp.example:636',
    LDAP_BIND_DN: 'CN=directory-reader,OU=Applications,DC=demo,DC=example',
    LDAP_BIND_PASSWORD: 'unit-test-only',
    LDAP_USER_BASE_DN: 'OU=People,DC=demo,DC=example',
    LDAP_CA_FILE: '/certs/root-ca.pem',
  };
}

describe('resolveLdapConfig', () => {
  it('parses a valid two-DC configuration with the default timeout', () => {
    const config = resolveLdapConfig(baseEnv(), readCa);
    expect(config.urls).toEqual(['ldaps://dc1.corp.example:636', 'ldaps://dc2.corp.example:636']);
    expect(config.bindDn).toBe('CN=directory-reader,OU=Applications,DC=demo,DC=example');
    expect(config.userBaseDn).toBe('OU=People,DC=demo,DC=example');
    expect(config.caCertificate).toEqual(CA_BYTES);
    expect(config.timeoutMs).toBe(3000);
  });

  it('honors LDAP_TIMEOUT_MS when set', () => {
    const config = resolveLdapConfig({ ...baseEnv(), LDAP_TIMEOUT_MS: '4500' }, readCa);
    expect(config.timeoutMs).toBe(4500);
  });

  it('trims and drops empty entries in LDAP_URLS', () => {
    const config = resolveLdapConfig(
      { ...baseEnv(), LDAP_URLS: 'ldaps://a:636, ldaps://b:636 ,,' },
      readCa,
    );
    expect(config.urls).toEqual(['ldaps://a:636', 'ldaps://b:636']);
  });

  it.each<[keyof LdapEnv]>([
    ['LDAP_URLS'],
    ['LDAP_BIND_DN'],
    ['LDAP_BIND_PASSWORD'],
    ['LDAP_USER_BASE_DN'],
    ['LDAP_CA_FILE'],
  ])('rejects a missing %s', (name) => {
    const env = { ...baseEnv(), [name]: undefined };
    expect(() => resolveLdapConfig(env, readCa)).toThrow(new RegExp(name));
  });

  it('rejects an empty LDAP_URLS list', () => {
    expect(() => resolveLdapConfig({ ...baseEnv(), LDAP_URLS: ' , , ' }, readCa)).toThrow(
      /LDAP_URLS is required/,
    );
  });

  it('refuses a plaintext ldap:// URL, because only LDAPS is accepted', () => {
    expect(() =>
      resolveLdapConfig({ ...baseEnv(), LDAP_URLS: 'ldap://dc1.corp.example:389' }, readCa),
    ).toThrow(/ldaps:\/\//);
  });

  it('surfaces an unreadable CA file with the path in the message', () => {
    const readFail = (): Buffer => {
      throw new Error('ENOENT: no such file');
    };
    expect(() => resolveLdapConfig(baseEnv(), readFail)).toThrow(/LDAP_CA_FILE.*not readable/);
  });

  it('rejects an empty CA file', () => {
    expect(() => resolveLdapConfig(baseEnv(), () => Buffer.alloc(0))).toThrow(
      /LDAP_CA_FILE.*is empty/,
    );
  });

  it.each([
    ['non-numeric', 'soon'],
    ['zero', '0'],
    ['negative', '-1'],
  ])('rejects a %s LDAP_TIMEOUT_MS', (_label, raw) => {
    expect(() => resolveLdapConfig({ ...baseEnv(), LDAP_TIMEOUT_MS: raw }, readCa)).toThrow(
      /LDAP_TIMEOUT_MS/,
    );
  });
});
