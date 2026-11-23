// The identity composition root: the user, session and break-glass stores, the sign-in provider and the session policy.
// Storage follows apps/api/src/config/persistence-guard.ts. The provider settings and their refusals are in modules/identity/src/domain/.
// A session has an idle and an absolute limit: docs/decisions/005-server-side-sessions.md.
import { createPool } from '@erp/db';
import {
  Argon2PasswordHasher,
  AuthenticationService,
  ConsoleAlertSink,
  ConsoleAuditSink,
  DrizzleBreakGlassStore,
  DrizzleSessionStore,
  DrizzleUserRepository,
  InMemoryBreakGlassStore,
  InMemorySessionStore,
  InMemoryUserRepository,
  LdapAuthProvider,
  LocalAuthProvider,
  createIdentityDb,
  createLdaptsClientFactory,
  normalizeUsername,
  resolveAuthProviderName,
  resolveDevRoleSeeding,
  resolveLdapConfig,
  resolveLocalAuthPassword,
  resolveLocalAuthRoster,
  seedDevRoles,
  systemClock,
  type BreakGlassStore,
  type SessionStore,
  type UserRepository,
} from '@erp/identity';
import type { PersistenceMode } from '@erp/types';

import { resolvePersistenceModeFromEnv } from '../config/persistence-guard';
import type { AuthProvider } from '@erp/types';

export const SESSION_COOKIE_NAME = 'erp_session';

export const IDENTITY_STORES = Symbol('IDENTITY_STORES');

export const READ_ONLY_USERNAMES = Symbol('READ_ONLY_USERNAMES');

export interface IdentityStores {
  users: UserRepository;
  sessions: SessionStore;
  breakGlass: BreakGlassStore;

  close(): Promise<void>;
}

function minutesFromEnv(name: string, fallbackMinutes: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') {
    return fallbackMinutes * 60 * 1000;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive number of minutes (got "${raw}")`);
  }
  return parsed * 60 * 1000;
}

/**
 * Accounts that may read but never write, from READ_ONLY_USERS, normalised the way sign-in normalises a username.
 * apps/api/src/auth/roles.guard.ts applies the rule. Each entry is an account name, the name a sign-in stores
 * whichever name was typed: modules/identity/src/providers/ldap-auth-provider.ts. Throws at start on an entry
 * holding "@" or "\", a principal or down-level name that no stored username ever equals.
 */
export function resolveReadOnlyUsernames(env: NodeJS.ProcessEnv): ReadonlySet<string> {
  const raw = env.READ_ONLY_USERS;
  if (raw === undefined || raw === '') {
    return new Set();
  }
  const entries = raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');
  for (const entry of entries) {
    if (entry.includes('@') || entry.includes('\\')) {
      throw new Error(
        `READ_ONLY_USERS entry "${entry}" is not an account name: ` +
          "write the account's sAMAccountName on its own, without a domain",
      );
    }
  }
  return new Set(entries.map(normalizeUsername));
}

// The reserved break-glass username. Sign-in and the Admin grant in apps/api/src/admin/admin.factory.ts both read it here.
export function resolveBreakGlassUsername(env: NodeJS.ProcessEnv): string {
  return env.BREAK_GLASS_USERNAME ?? 'break-glass';
}

// In memory mode the break-glass credential comes from BREAK_GLASS_DEV_PASSWORD, or there is none.
async function seedDevBreakGlass(): Promise<BreakGlassStore> {
  const store = new InMemoryBreakGlassStore();
  const devPassword = process.env.BREAK_GLASS_DEV_PASSWORD;
  if (devPassword !== undefined && devPassword !== '') {
    await store.setPassword(await new Argon2PasswordHasher().hash(devPassword));
  }
  return store;
}

export async function createIdentityStores(): Promise<IdentityStores> {
  const persistence = resolvePersistenceModeFromEnv(process.env);

  if (persistence === 'memory') {
    const users = new InMemoryUserRepository();

    if (devRoleSeeding(persistence)) {
      await seedDevRoles(users, resolveLocalAuthRoster(process.env.LOCAL_AUTH_USERS));
    }
    return {
      users,
      sessions: new InMemorySessionStore(),
      breakGlass: await seedDevBreakGlass(),
      close: async () => {},
    };
  }

  // Called for its refusal alone: DEV_SEED_ROLES set on PostgreSQL stops the boot here instead of being ignored.
  devRoleSeeding(persistence);

  const devPassword = process.env.BREAK_GLASS_DEV_PASSWORD;
  if (devPassword !== undefined && devPassword !== '') {
    console.warn(
      'BREAK_GLASS_DEV_PASSWORD is ignored when identity persists to Postgres. ' +
        'Provision the credential with `pnpm --filter @erp/identity break-glass:set`.',
    );
  }

  const pool = createPool();
  const db = createIdentityDb(pool);
  return {
    users: new DrizzleUserRepository(db),
    sessions: new DrizzleSessionStore(db),
    breakGlass: new DrizzleBreakGlassStore(db),
    close: () => pool.end(),
  };
}

function devRoleSeeding(persistence: PersistenceMode): boolean {
  const flag = process.env.DEV_SEED_ROLES;

  if (flag === undefined || flag === '') {
    return false;
  }
  return resolveDevRoleSeeding(
    flag,
    resolveAuthProviderName(process.env.AUTH_PROVIDER, process.env.NODE_ENV),
    persistence,
    process.env.NODE_ENV,
  );
}

export async function createAuthenticationService(
  stores: IdentityStores,
): Promise<AuthenticationService> {
  const providerName = resolveAuthProviderName(process.env.AUTH_PROVIDER, process.env.NODE_ENV);

  let provider: AuthProvider;
  // The local provider takes its password and roster from configuration and refuses to start without either:
  // modules/identity/src/domain/local-auth-config.ts.
  if (providerName === 'local') {
    provider = new LocalAuthProvider(
      resolveLocalAuthPassword(process.env.LOCAL_AUTH_PASSWORD),
      resolveLocalAuthRoster(process.env.LOCAL_AUTH_USERS),
    );
  } else {
    const ldapConfig = resolveLdapConfig(process.env);
    provider = new LdapAuthProvider(ldapConfig, createLdaptsClientFactory(ldapConfig));
  }

  return new AuthenticationService({
    provider,
    users: stores.users,
    sessions: stores.sessions,
    breakGlass: stores.breakGlass,
    hasher: new Argon2PasswordHasher(),
    audit: new ConsoleAuditSink(),
    alerts: new ConsoleAlertSink(),
    // Real time, not apps/api/src/test-clock.ts, so session expiry never follows a clock a test has moved.
    // apps/api/test/one-clock-at-the-root.test.ts lists this exception.
    clock: systemClock,
    breakGlassUsername: resolveBreakGlassUsername(process.env),
    sessionPolicy: {
      idleTimeoutMs: minutesFromEnv('SESSION_IDLE_TIMEOUT_MINUTES', 8 * 60),
      absoluteLifetimeMs: minutesFromEnv('SESSION_ABSOLUTE_TIMEOUT_MINUTES', 12 * 60),
    },
  });
}
