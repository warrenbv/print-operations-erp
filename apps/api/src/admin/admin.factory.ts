// Builds `AdminRoleService` over the identity stores and the directory that matches AUTH_PROVIDER.
// The local directory lists exactly the LOCAL_AUTH_USERS roster, so Admin sees only accounts that can sign in.
import {
  AdminRoleService,
  ConsoleAuditSink,
  LdaptsLdapDirectory,
  LocalLdapDirectory,
  createLdaptsClientFactory,
  resolveAuthProviderName,
  resolveLdapConfig,
  resolveLocalAuthRoster,
  type LdapDirectory,
  type UserRepository,
} from '@erp/identity';

import { resolveBreakGlassUsername, type IdentityStores } from '../auth/auth.factory';
import { apiClock } from '../test-clock';

function createDirectory(): LdapDirectory {
  const providerName = resolveAuthProviderName(process.env.AUTH_PROVIDER, process.env.NODE_ENV);
  if (providerName === 'local') {
    return new LocalLdapDirectory(resolveLocalAuthRoster(process.env.LOCAL_AUTH_USERS));
  }
  const ldapConfig = resolveLdapConfig(process.env);
  return new LdaptsLdapDirectory(ldapConfig, createLdaptsClientFactory(ldapConfig));
}

export async function createAdminRoleService(stores: IdentityStores): Promise<AdminRoleService> {
  const users: UserRepository = stores.users;
  return new AdminRoleService({
    users,
    directory: createDirectory(),
    audit: new ConsoleAuditSink(),
    clock: apiClock,
    breakGlassUsername: resolveBreakGlassUsername(process.env),
  });
}
