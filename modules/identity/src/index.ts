// Public surface of the identity module. The API wires it in apps/api/src/auth/auth.factory.ts and
// apps/api/src/admin/admin.factory.ts. See modules/identity/README.md.
export { normalizeUsername, isBreakGlassUsername } from './domain/username';
export { resolveAuthProviderName, type AuthProviderName } from './domain/provider-guard';
export { resolveDevRoleSeeding } from './domain/dev-role-guard';
export { resolveLocalAuthPassword, resolveLocalAuthRoster } from './domain/local-auth-config';
export {
  DEFAULT_SESSION_POLICY,
  generateSessionToken,
  hashSessionToken,
  isSessionExpired,
  sessionExpiresAt,
  type SessionPolicy,
} from './domain/session';
export {
  DEFAULT_LOCKOUT_POLICY,
  isLockedOut,
  recordFailure,
  recordSuccess,
  type LockoutPolicy,
} from './domain/break-glass';

export {
  AuthenticationService,
  BREAK_GLASS_EXTERNAL_ID,
  BREAK_GLASS_ROLE,
  type AuthenticationServiceOptions,
  type LoginContext,
  type LoginOutcome,
  type ResolvedSession,
} from './authentication-service';

export {
  LocalAuthProvider,
  DEV_USERNAMES,
  DEV_EMAIL_DOMAIN,
  devEmailFor,
  type DevUsername,
} from './providers/local-auth-provider';
export { LdapAuthProvider } from './providers/ldap-auth-provider';
export {
  LdaptsLdapDirectory,
  type LdapDirectory,
  type LdapDirectoryUser,
} from './providers/ldap-directory';
export { LocalLdapDirectory } from './providers/local-directory';
export { DEV_USER_ROLES, seedDevRoles } from './dev-role-seed';
export {
  AdminRoleService,
  type AdminContext,
  type AdminRoleServiceOptions,
  type RoleAssignmentInput,
  type SetRolesOutcome,
} from './admin-role-service';
export {
  LdapInvalidCredentialsError,
  LdapUnreachableError,
  type LdapClient,
  type LdapClientFactory,
  type LdapUserEntry,
} from './providers/ldap-client';
export { resolveLdapConfig, type LdapConfig, type LdapEnv } from './domain/ldap-config';
export { escapeLdapFilterValue } from './domain/ldap-filter';

export { systemClock } from './adapters/system-clock';
export { createLdaptsClientFactory } from './adapters/ldapts-client';
export { Argon2PasswordHasher } from './adapters/argon2-password-hasher';
export { ConsoleAuditSink, ConsoleAlertSink } from './adapters/logging-sinks';
export { InMemoryUserRepository } from './adapters/in-memory/in-memory-user-repository';
export { InMemorySessionStore } from './adapters/in-memory/in-memory-session-store';
export { InMemoryBreakGlassStore } from './adapters/in-memory/in-memory-break-glass-store';

export { createIdentityDb, type IdentityDb } from './data/identity-db';
export { DrizzleUserRepository } from './adapters/drizzle/drizzle-user-repository';
export { DrizzleSessionStore } from './adapters/drizzle/drizzle-session-store';
export { DrizzleBreakGlassStore } from './adapters/drizzle/drizzle-break-glass-store';

export type {
  Alert,
  AlertSink,
  AuditEvent,
  AuditEventType,
  AuditSink,
  BreakGlassFailure,
  BreakGlassRecord,
  BreakGlassStore,
  BreakGlassSuccess,
  Clock,
  ErpUser,
  PasswordHasher,
  SessionRecord,
  SessionStore,
  UserRepository,
} from './ports';
