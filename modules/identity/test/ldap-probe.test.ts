// Tests the checks behind `ldap:probe` in modules/identity/src/cli/ldap-probe.ts and its report.
import { describe, expect, it } from 'vitest';

import { formatReport, probeSucceeded, runLdapProbe } from '../src/cli/ldap-probe';
import type { LdapConfig } from '../src/domain/ldap-config';
import {
  LdapInvalidCredentialsError,
  LdapUnreachableError,
  type LdapClient,
  type LdapClientFactory,
  type LdapUserEntry,
} from '../src/providers/ldap-client';

const SERVICE_PW = 'service-pw';
const USER_PW = 'user-pw';

function config(overrides: Partial<LdapConfig> = {}): LdapConfig {
  return {
    urls: ['ldaps://dc1:636', 'ldaps://dc2:636'],
    bindDn: 'CN=directory-reader,OU=Applications,DC=demo',
    bindPassword: SERVICE_PW,
    userBaseDn: 'DC=demo',
    caCertificate: Buffer.from('ca'),
    timeoutMs: 3000,
    ...overrides,
  };
}

function jane(overrides: Partial<LdapUserEntry> = {}): LdapUserEntry {
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

function directory(
  dcs: Record<string, 'ok' | 'refuses-tcp' | 'bad-tls' | 'rejects-service'>,
  entries: readonly LdapUserEntry[] = [jane()],
): { factory: LdapClientFactory; binds: string[] } {
  const binds: string[] = [];
  const factory: LdapClientFactory = async (url) => {
    const mode = dcs[url];
    if (mode === undefined || mode === 'refuses-tcp') {
      throw new LdapUnreachableError('connect ECONNREFUSED');
    }
    const client: LdapClient = {
      bind: async (dn, password) => {
        binds.push(`${url} ${dn}`);
        if (mode === 'bad-tls') {
          throw new LdapUnreachableError('unable to verify the first certificate');
        }
        const isService = dn.startsWith('CN=directory-reader');
        if (isService) {
          if (mode === 'rejects-service' || password !== SERVICE_PW) {
            throw new LdapInvalidCredentialsError();
          }
          return;
        }
        const entry = entries.find((e) => e.dn === dn);
        if (entry === undefined || password !== USER_PW) {
          throw new LdapInvalidCredentialsError();
        }
      },
      search: async (_baseDn, filter) => {
        const m = /\(sAMAccountName=([^)]+)\)/.exec(filter);
        return entries.filter((e) => e.sAMAccountName === m?.[1]);
      },
      unbind: async () => {},
    };
    return client;
  };
  return { factory, binds };
}

describe('runLdapProbe', () => {
  it('binds the service account against every configured DC, not just the first', async () => {
    const { factory, binds } = directory({ 'ldaps://dc1:636': 'ok', 'ldaps://dc2:636': 'ok' });
    const report = await runLdapProbe(config(), factory);

    expect(report.urls).toEqual([
      { url: 'ldaps://dc1:636', outcome: 'ok' },
      { url: 'ldaps://dc2:636', outcome: 'ok' },
    ]);
    expect(binds).toHaveLength(2);
    expect(probeSucceeded(report)).toBe(true);
  });

  it('distinguishes a rejected credential from an unreachable or untrusted DC', async () => {
    const { factory } = directory({
      'ldaps://dc1:636': 'rejects-service',
      'ldaps://dc2:636': 'bad-tls',
    });
    const report = await runLdapProbe(
      config({ urls: ['ldaps://dc1:636', 'ldaps://dc2:636', 'ldaps://dc3:636'] }),
      factory,
    );

    expect(report.urls).toEqual([
      { url: 'ldaps://dc1:636', outcome: 'rejected' },
      {
        url: 'ldaps://dc2:636',
        outcome: 'unreachable',
        detail: 'unable to verify the first certificate',
      },
      { url: 'ldaps://dc3:636', outcome: 'unreachable', detail: 'connect ECONNREFUSED' },
    ]);
    expect(report.user).toBeUndefined();
    expect(probeSucceeded(report)).toBe(false);
  });

  it('looks the user up with the provider filter and reports account state', async () => {
    const { factory } = directory({ 'ldaps://dc1:636': 'ok', 'ldaps://dc2:636': 'ok' }, [
      jane({ userAccountControl: 0x0202 }),
    ]);
    const report = await runLdapProbe(config(), factory, { username: 'Jane.Doe' });

    expect(report.user).toEqual({
      username: 'Jane.Doe',
      found: true,
      dn: 'CN=Alex Example,OU=People,DC=demo',
      sAMAccountName: 'jane.doe',
      displayName: 'Alex Example',
      mail: 'jane.doe@corp.example',
      disabled: true,
    });
    expect(report.login).toBeUndefined();
  });

  it('reports a missing user without failing the service-bind evidence', async () => {
    const { factory } = directory({ 'ldaps://dc1:636': 'ok', 'ldaps://dc2:636': 'ok' });
    const report = await runLdapProbe(config(), factory, { username: 'nobody' });

    expect(report.user).toEqual({ username: 'nobody', found: false });
    expect(report.urls.every((u) => u.outcome === 'ok')).toBe(true);
    expect(probeSucceeded(report)).toBe(false);
  });

  it('skips the user stages when no DC accepted the service bind', async () => {
    const { factory } = directory({
      'ldaps://dc1:636': 'refuses-tcp',
      'ldaps://dc2:636': 'refuses-tcp',
    });
    const report = await runLdapProbe(config(), factory, {
      username: 'jane.doe',
      password: USER_PW,
    });

    expect(report.user).toBeUndefined();
    expect(report.login).toBeUndefined();
  });

  it('runs the real provider flow for --login and reports its outcome', async () => {
    const { factory } = directory({ 'ldaps://dc1:636': 'ok', 'ldaps://dc2:636': 'ok' });

    const ok = await runLdapProbe(config(), factory, { username: 'jane.doe', password: USER_PW });
    expect(ok.login).toBe('ok');
    expect(probeSucceeded(ok)).toBe(true);

    const wrong = await runLdapProbe(config(), factory, { username: 'jane.doe', password: 'nope' });
    expect(wrong.login).toBe('invalid-credentials');
    expect(probeSucceeded(wrong)).toBe(false);
  });

  it('renders a report with no credential material in it', async () => {
    const { factory } = directory({
      'ldaps://dc1:636': 'ok',
      'ldaps://dc2:636': 'rejects-service',
    });
    const report = await runLdapProbe(config(), factory, {
      username: 'jane.doe',
      password: USER_PW,
    });
    const text = formatReport(report, config());

    expect(text).toContain('✔ ldaps://dc1:636 — ok');
    expect(text).toContain('✖ ldaps://dc2:636 — rejected');
    expect(text).toContain('CN=Alex Example,OU=People,DC=demo');
    expect(text).toContain('login as "jane.doe" — ✔ ok');
    expect(text).toContain('RESULT: FAIL');
    expect(text).not.toContain(SERVICE_PW);
    expect(text).not.toContain(USER_PW);
  });
});
