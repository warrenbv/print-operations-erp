// The second global guard. It decides whether the signed-in user may call this route, and it denies by default.
// It runs after apps/api/src/auth/session.guard.ts, which sets `request.erpUser`. The tiers: apps/api/src/auth/authz.decorators.ts.
// Every route is classified by apps/api/test/every-role-reads-every-get.test.ts and apps/api/test/read-only-refuses-every-write.test.ts.
import { AuthenticationService, normalizeUsername } from '@erp/identity';
import type { ErpRole } from '@erp/types';
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import type { AuthenticatedRequest } from './session.guard';
import { READ_ONLY_USERNAMES } from './auth.factory';
import { IS_AUTHENTICATED_KEY, IS_PUBLIC_KEY, REQUIRED_ROLES_KEY } from './authz.decorators';

const READ_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD']);

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    @Inject(AuthenticationService) private readonly auth: AuthenticationService,
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(READ_ONLY_USERNAMES) private readonly readOnlyUsernames: ReadonlySet<string>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic === true) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = request.erpUser;
    if (user === undefined) {
      throw new UnauthorizedException();
    }

    // The read-only rule runs before the tier check, so it refuses `@Authenticated()` writes too. It matches the
    // stored username, which is a directory account's account name under either of its sign-in names:
    // modules/identity/src/providers/ldap-auth-provider.ts.
    if (
      this.readOnlyUsernames.has(normalizeUsername(user.username)) &&
      !READ_METHODS.has((request.method ?? '').toUpperCase())
    ) {
      await this.#recordDeny(user, request, [], 'read-only account (READ_ONLY_USERS)');
      throw new ForbiddenException();
    }

    const isAuthenticated = this.reflector.getAllAndOverride<boolean>(IS_AUTHENTICATED_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isAuthenticated === true) {
      return true;
    }

    const requiredRoles = this.reflector.getAllAndOverride<readonly ErpRole[] | undefined>(
      REQUIRED_ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    // No decorator, or an empty list, is refused and audited. A route nobody classified stays closed.
    if (requiredRoles === undefined || requiredRoles.length === 0) {
      await this.#recordDeny(user, request, []);
      throw new ForbiddenException();
    }

    const matches = requiredRoles.some((role) => user.roles.includes(role));
    if (!matches) {
      await this.#recordDeny(user, request, requiredRoles);
      throw new ForbiddenException();
    }
    return true;
  }

  async #recordDeny(
    user: NonNullable<AuthenticatedRequest['erpUser']>,
    request: AuthenticatedRequest,
    requiredRoles: readonly ErpRole[],
    cause?: string,
  ): Promise<void> {
    const route = requestRoute(request);
    const context = { ...(request.ip === undefined ? {} : { sourceIp: request.ip }) };

    if (cause === undefined) {
      await this.auth.recordAuthorizationDenied(user, route, requiredRoles, context);
      return;
    }

    await this.auth.recordAuthorizationDenied(user, route, requiredRoles, context, cause);
  }
}

function requestRoute(request: AuthenticatedRequest): string {
  const method = request.method ?? 'UNKNOWN';
  // The matched route pattern when there is one, so audit lines group by route rather than by concrete path.
  const routeShape = (request as unknown as { route?: { path?: string } }).route?.path;
  const path = routeShape ?? request.path ?? '(unknown)';
  return `${method} ${path}`;
}
