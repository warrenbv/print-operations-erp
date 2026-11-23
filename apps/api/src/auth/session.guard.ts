// The first global guard. It resolves the session cookie to a user on every request and sets `request.erpUser`.
// The user and roles are read fresh each time, so an ended session or a role change takes effect at once: docs/decisions/005-server-side-sessions.md.
// Public routes skip it. Authorization follows in apps/api/src/auth/roles.guard.ts.
import { AuthenticationService, type ErpUser } from '@erp/identity';
import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import { SESSION_COOKIE_NAME } from './auth.factory';
import { IS_PUBLIC_KEY } from './authz.decorators';

export interface AuthenticatedRequest extends Request {
  erpUser?: ErpUser;
}

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    @Inject(AuthenticationService) private readonly auth: AuthenticationService,
    private readonly reflector: Reflector,
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
    const cookies: unknown = request.cookies;
    const token =
      typeof cookies === 'object' && cookies !== null
        ? (cookies as Record<string, unknown>)[SESSION_COOKIE_NAME]
        : undefined;

    if (typeof token !== 'string' || token === '') {
      throw new UnauthorizedException();
    }

    const resolved = await this.auth.resolveSession(token);
    if (resolved === null) {
      throw new UnauthorizedException();
    }

    request.erpUser = resolved.user;
    return true;
  }
}
