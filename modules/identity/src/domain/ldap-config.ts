// Reads and checks the directory settings when `AUTH_PROVIDER` is `ldap`. Every setting but the
// timeout is required, and a missing or invalid one throws at start-up, before any sign-in.
// The provider that uses it: modules/identity/src/providers/ldap-auth-provider.ts.
import { readFileSync } from 'node:fs';

export interface LdapConfig {
  urls: readonly string[];
  bindDn: string;
  bindPassword: string;
  userBaseDn: string;

  // The CA that signed the directory's certificate, read from `LDAP_CA_FILE`. It must be non-empty.
  caCertificate: Buffer;

  timeoutMs: number;
}

const DEFAULT_TIMEOUT_MS = 3000;

export interface LdapEnv {
  LDAP_URLS?: string;
  LDAP_BIND_DN?: string;
  LDAP_BIND_PASSWORD?: string;
  LDAP_USER_BASE_DN?: string;
  LDAP_CA_FILE?: string;
  LDAP_TIMEOUT_MS?: string;
}

export type ReadFileSync = (path: string) => Buffer;

export function resolveLdapConfig(env: LdapEnv, readFile: ReadFileSync = readFileSync): LdapConfig {
  const urls = parseUrls(requireEnv(env.LDAP_URLS, 'LDAP_URLS'));
  const bindDn = requireEnv(env.LDAP_BIND_DN, 'LDAP_BIND_DN');
  const bindPassword = requireEnv(env.LDAP_BIND_PASSWORD, 'LDAP_BIND_PASSWORD');
  const userBaseDn = requireEnv(env.LDAP_USER_BASE_DN, 'LDAP_USER_BASE_DN');
  const caPath = requireEnv(env.LDAP_CA_FILE, 'LDAP_CA_FILE');

  let caCertificate: Buffer;
  try {
    caCertificate = readFile(caPath);
  } catch (err) {
    throw new Error(
      `LDAP_CA_FILE "${caPath}" is not readable: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (caCertificate.length === 0) {
    throw new Error(`LDAP_CA_FILE "${caPath}" is empty`);
  }

  return {
    urls,
    bindDn,
    bindPassword,
    userBaseDn,
    caCertificate,
    timeoutMs: parseTimeout(env.LDAP_TIMEOUT_MS),
  };
}

function requireEnv(value: string | undefined, name: string): string {
  if (value === undefined || value === '') {
    throw new Error(`${name} is required when AUTH_PROVIDER=ldap`);
  }
  return value;
}

function parseUrls(raw: string): readonly string[] {
  const urls = raw
    .split(',')
    .map((u) => u.trim())
    .filter((u) => u.length > 0);
  if (urls.length === 0) {
    throw new Error('LDAP_URLS is required when AUTH_PROVIDER=ldap');
  }
  for (const url of urls) {
    // Every endpoint must be TLS. One plain `ldap://` entry refuses the whole list.
    if (!url.startsWith('ldaps://')) {
      throw new Error(`LDAP URL "${url}" must use ldaps:// — plaintext ldap:// is refused`);
    }
  }
  return urls;
}

function parseTimeout(raw: string | undefined): number {
  if (raw === undefined || raw === '') {
    return DEFAULT_TIMEOUT_MS;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`LDAP_TIMEOUT_MS must be a positive number of milliseconds (got "${raw}")`);
  }
  return parsed;
}
