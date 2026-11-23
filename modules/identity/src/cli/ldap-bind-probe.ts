// `ldap:probe`: checks the directory settings from the command line before anyone signs in. It binds
// the service account at each endpoint and can look up one user and sign in as them. Passwords are
// typed at a hidden prompt, never passed as arguments. Exits non-zero on any failure.
// The checks themselves: modules/identity/src/cli/ldap-probe.ts.
import { createLdaptsClientFactory } from '../adapters/ldapts-client';
import { resolveLdapConfig, type LdapEnv } from '../domain/ldap-config';

import { formatReport, probeSucceeded, runLdapProbe } from './ldap-probe';
import { promptHidden } from './prompt-hidden';

interface Args {
  username?: string;
  login: boolean;
}

function parseArgs(argv: readonly string[]): Args {
  const args: Args = { login: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--user') {
      const value = argv[++i];
      if (value === undefined || value === '') {
        throw new Error('--user needs a sAMAccountName');
      }
      args.username = value;
    } else if (a === '--login') {
      args.login = true;
    } else if (a === '-h' || a === '--help') {
      console.info('usage: ldap:probe [--user <sAMAccountName>] [--login]');
      process.exit(0);
    } else {
      throw new Error(`unknown argument ${a}`);
    }
  }
  if (args.login && args.username === undefined) {
    throw new Error('--login needs --user <sAMAccountName>');
  }
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const env: LdapEnv = { ...process.env };
  if (env.LDAP_BIND_PASSWORD === undefined || env.LDAP_BIND_PASSWORD === '') {
    if (!process.stdin.isTTY) {
      throw new Error(
        'LDAP_BIND_PASSWORD is not set and there is no terminal to prompt on. ' +
          'Set it in the environment (e.g. node --env-file=.env …) or run interactively.',
      );
    }
    env.LDAP_BIND_PASSWORD = await promptHidden(
      `Password for ${env.LDAP_BIND_DN ?? 'LDAP_BIND_DN'}: `,
    );
  }

  const config = resolveLdapConfig(env);

  let password: string | undefined;
  if (args.login) {
    if (!process.stdin.isTTY) {
      throw new Error('--login needs an interactive terminal: the password is typed at a prompt.');
    }
    password = await promptHidden(`Password for ${args.username ?? ''}: `);
  }

  const report = await runLdapProbe(config, createLdaptsClientFactory(config), {
    ...(args.username === undefined ? {} : { username: args.username }),
    ...(password === undefined ? {} : { password }),
  });

  console.info(formatReport(report, config));
  process.exitCode = probeSucceeded(report) ? 0 : 1;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
