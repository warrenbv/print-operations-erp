// The checks behind `ldap:probe`, kept apart from the command line so tests can drive them with a
// scripted client. Sign-in reports one reason for many failures. This names which part failed.
import type { LdapConfig } from '../domain/ldap-config';
import { normalizeUsername } from '../domain/username';
import { LdapAuthProvider, buildUserFilter } from '../providers/ldap-auth-provider';
import {
  LdapInvalidCredentialsError,
  LdapUnreachableError,
  type LdapClientFactory,
  type LdapUserEntry,
} from '../providers/ldap-client';

const ACCOUNTDISABLE = 0x0002;

export type ServiceBindOutcome = 'ok' | 'rejected' | 'unreachable';

export interface UrlProbe {
  url: string;
  outcome: ServiceBindOutcome;

  detail?: string;
}

export interface UserProbe {
  username: string;
  found: boolean;
  dn?: string;
  sAMAccountName?: string;
  displayName?: string;
  mail?: string;
  disabled?: boolean;

  // More than one entry matched. Sign-in would take the first, so the probe fails.
  ambiguous?: boolean;
}

export type LoginOutcome = 'ok' | 'invalid-credentials' | 'directory-unreachable';

export interface ProbeReport {
  urls: readonly UrlProbe[];
  user?: UserProbe;
  login?: LoginOutcome;
}

export interface ProbeRequest {
  username?: string;

  password?: string;
}

export async function runLdapProbe(
  config: LdapConfig,
  factory: LdapClientFactory,
  request: ProbeRequest = {},
): Promise<ProbeReport> {
  const urls: UrlProbe[] = [];
  let firstGood: string | undefined;

  for (const url of config.urls) {
    const probe = await probeServiceBind(url, config, factory);
    urls.push(probe);
    if (probe.outcome === 'ok' && firstGood === undefined) {
      firstGood = url;
    }
  }

  const report: ProbeReport = { urls };
  if (request.username === undefined || firstGood === undefined) {
    return report;
  }

  report.user = await probeUser(firstGood, config, factory, request.username);

  if (request.password !== undefined) {
    const result = await new LdapAuthProvider(config, factory).authenticate(
      request.username,
      request.password,
    );
    report.login = result.ok ? 'ok' : result.reason;
  }

  return report;
}

async function probeServiceBind(
  url: string,
  config: LdapConfig,
  factory: LdapClientFactory,
): Promise<UrlProbe> {
  let client;
  try {
    client = await factory(url);
  } catch (err) {
    return { url, outcome: 'unreachable', detail: messageOf(err) };
  }
  try {
    await client.bind(config.bindDn, config.bindPassword);
    return { url, outcome: 'ok' };
  } catch (err) {
    if (err instanceof LdapInvalidCredentialsError) {
      return { url, outcome: 'rejected' };
    }
    return { url, outcome: 'unreachable', detail: messageOf(err) };
  } finally {
    await client.unbind();
  }
}

async function probeUser(
  url: string,
  config: LdapConfig,
  factory: LdapClientFactory,
  username: string,
): Promise<UserProbe> {
  const client = await factory(url);
  try {
    await client.bind(config.bindDn, config.bindPassword);

    const entries = await client.search(
      config.userBaseDn,
      buildUserFilter(normalizeUsername(username)),
    );
    const entry = entries[0];
    if (entry === undefined) {
      return { username, found: false };
    }
    return {
      ...describe(username, entry),
      ...(entries.length > 1 ? { ambiguous: true } : {}),
    };
  } finally {
    await client.unbind();
  }
}

function describe(username: string, entry: LdapUserEntry): UserProbe {
  return {
    username,
    found: true,
    dn: entry.dn,
    sAMAccountName: entry.sAMAccountName,
    displayName: entry.displayName,
    ...(entry.mail === undefined ? {} : { mail: entry.mail }),
    disabled: (entry.userAccountControl & ACCOUNTDISABLE) !== 0,
  };
}

function messageOf(err: unknown): string {
  if (err instanceof LdapUnreachableError || err instanceof Error) {
    return err.message;
  }
  return String(err);
}

/** Passes only when every endpoint binds, not just one, and any requested lookup and sign-in succeed. */
export function probeSucceeded(report: ProbeReport): boolean {
  const bindsOk = report.urls.length > 0 && report.urls.every((u) => u.outcome === 'ok');
  const loginOk = report.login === undefined || report.login === 'ok';
  const userOk = report.user === undefined || (report.user.found && !report.user.ambiguous);
  return bindsOk && userOk && loginOk;
}

export function formatReport(
  report: ProbeReport,
  config: Pick<LdapConfig, 'bindDn' | 'userBaseDn'>,
): string {
  const lines: string[] = [];
  lines.push(`service bind as ${config.bindDn}`);
  for (const u of report.urls) {
    const mark = u.outcome === 'ok' ? '✔' : '✖';
    lines.push(`  ${mark} ${u.url} — ${u.outcome}${u.detail === undefined ? '' : `: ${u.detail}`}`);
  }
  if (report.user !== undefined) {
    const u = report.user;
    lines.push(`user lookup "${u.username}" under ${config.userBaseDn}`);
    if (!u.found) {
      lines.push('  ✖ no entry matched');
    } else {
      lines.push(`  ✔ ${u.dn}`);
      lines.push(
        `    sAMAccountName=${u.sAMAccountName ?? ''} displayName="${u.displayName ?? ''}"` +
          `${u.mail === undefined ? '' : ` mail=${u.mail}`} ${u.disabled === true ? 'DISABLED' : 'enabled'}`,
      );
      if (u.ambiguous === true) {
        lines.push('  ✖ more than one entry matched — the filter is not unique');
      }
    }
  }
  if (report.login !== undefined) {
    lines.push(
      `login as "${report.user?.username ?? ''}" — ${report.login === 'ok' ? '✔ ok' : `✖ ${report.login}`}`,
    );
  }
  lines.push(probeSucceeded(report) ? 'RESULT: PASS' : 'RESULT: FAIL');
  return lines.join('\n');
}
