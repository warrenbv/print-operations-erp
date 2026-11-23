// Roles for the local provider's fixed accounts, so a development or demonstration run starts with one
// account per desk. The API calls it only when modules/identity/src/domain/dev-role-guard.ts allows.
import type { ErpRole } from '@erp/types';

import type { UserRepository } from './ports';
import { DEV_USERNAMES, devEmailFor, type DevUsername } from './providers/local-auth-provider';

export const DEV_USER_ROLES: Readonly<Record<DevUsername, readonly ErpRole[]>> = {
  'dev-sales': ['Sales'],
  'dev-billing': ['Billing'],
  'dev-production': ['Production'],
  'dev-production-manager': ['ProductionManager'],
  'dev-admin': ['Admin'],
  'dev-noroles': [],
};

export async function seedDevRoles(
  users: UserRepository,
  usernames: readonly DevUsername[] = DEV_USERNAMES,
): Promise<void> {
  for (const username of usernames) {
    const roles = DEV_USER_ROLES[username];
    // An account with no roles is not provisioned, so it is created on its first sign-in with none.
    if (roles.length === 0) {
      continue;
    }
    // The same identity LocalAuthProvider returns, so a later sign-in updates this row.
    const user = await users.upsertFromIdentity({
      externalId: `local:${username}`,
      username,
      displayName: username,

      email: devEmailFor(username),
    });
    await users.setRoles(user.id, roles);
  }
}
