// Sign-in, sign-out and the signed-in user. A session is a server-side record behind an opaque httpOnly cookie: docs/decisions/005-server-side-sessions.md.
// Credentials are checked by `AuthenticationService` in modules/identity/src/authentication-service.ts.
import { AuthenticationService, type ErpUser } from '@erp/identity';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Post,
  Req,
  Res,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  loginRequestSchema,
  loginResponseSchema,
  sessionUserSchema,
  type LoginResponse,
  type SessionUser,
} from '@erp/types';
import type { Response } from 'express';

import { SESSION_COOKIE_NAME } from './auth.factory';
import { Authenticated, Public } from './authz.decorators';
import type { AuthenticatedRequest } from './session.guard';

function toSessionUser(user: ErpUser): SessionUser {
  return sessionUserSchema.parse({
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    ...(user.email === undefined ? {} : { email: user.email }),
    roles: [...user.roles],
  });
}

@Controller('auth')
export class AuthController {
  constructor(@Inject(AuthenticationService) private readonly auth: AuthenticationService) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<LoginResponse> {
    const parsed = loginRequestSchema.safeParse(body);
    if (!parsed.success) {
      // A malformed body is answered as a failed sign-in, with no detail on which field was wrong.
      throw new UnauthorizedException({ reason: 'invalid-credentials' });
    }

    const outcome = await this.auth.login(parsed.data.username, parsed.data.password, {
      ...(request.ip === undefined ? {} : { sourceIp: request.ip }),
    });

    if (!outcome.ok) {
      // An unreachable directory is 503, so the page never reports it as a wrong password.
      if (outcome.reason === 'directory-unreachable') {
        throw new ServiceUnavailableException({ reason: outcome.reason });
      }
      throw new UnauthorizedException({ reason: outcome.reason });
    }

    response.cookie(SESSION_COOKIE_NAME, outcome.token, {
      httpOnly: true,
      sameSite: 'lax',
      // `Secure` is on unless SESSION_COOKIE_INSECURE is "true", which a plain-HTTP local run needs: docs/decisions/005-server-side-sessions.md.
      secure: process.env.SESSION_COOKIE_INSECURE !== 'true',
      path: '/',
      expires: outcome.expiresAt,
    });

    return loginResponseSchema.parse({
      user: toSessionUser(outcome.user),
      expiresAt: outcome.expiresAt.toISOString(),
    });
  }

  // Public, so a client whose session has already ended can still clear its cookie.
  @Public()
  @Post('logout')
  @HttpCode(204)
  async logout(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    const cookies: unknown = request.cookies;
    const token =
      typeof cookies === 'object' && cookies !== null
        ? (cookies as Record<string, unknown>)[SESSION_COOKIE_NAME]
        : undefined;

    if (typeof token === 'string' && token !== '') {
      await this.auth.logout(token, {
        ...(request.ip === undefined ? {} : { sourceIp: request.ip }),
      });
    }

    response.clearCookie(SESSION_COOKIE_NAME, { path: '/' });
  }

  @Authenticated()
  @Get('me')
  me(@Req() request: AuthenticatedRequest): SessionUser {
    if (request.erpUser === undefined) {
      throw new UnauthorizedException();
    }
    return toSessionUser(request.erpUser);
  }
}
