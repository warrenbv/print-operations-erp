// The three authorization tiers a route may declare: public, any signed-in user, or a list of roles.
// apps/api/src/auth/roles.guard.ts reads them and refuses a route that declares none. The role lists are in packages/types/src/roles.ts.
import { SetMetadata, type CustomDecorator } from '@nestjs/common';
import type { ErpRole } from '@erp/types';

export const IS_PUBLIC_KEY = 'authz:public';
export const IS_AUTHENTICATED_KEY = 'authz:authenticated';
export const REQUIRED_ROLES_KEY = 'authz:required-roles';

export const Public = (): CustomDecorator<string> => SetMetadata(IS_PUBLIC_KEY, true);

export const Authenticated = (): CustomDecorator<string> => SetMetadata(IS_AUTHENTICATED_KEY, true);

/** Admits a user holding any one of the listed roles. The tuple type refuses an empty list at compile time. */
export const RequireRoles = (...roles: readonly [ErpRole, ...ErpRole[]]): CustomDecorator<string> =>
  SetMetadata(REQUIRED_ROLES_KEY, roles);
