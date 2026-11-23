// Tests `RolesGuard`: the three tiers, default deny with an audit record, any-of role matching, and the read-only rule.
import type { AuthenticationService, ErpUser } from '@erp/identity';
import type { ErpRole } from '@erp/types';
import type { ExecutionContext } from '@nestjs/common';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveReadOnlyUsernames } from '../src/auth/auth.factory';
import { RolesGuard } from '../src/auth/roles.guard';
import type { AuthenticatedRequest } from '../src/auth/session.guard';
import {
  IS_AUTHENTICATED_KEY,
  IS_PUBLIC_KEY,
  REQUIRED_ROLES_KEY,
} from '../src/auth/authz.decorators';

interface HarnessOptions {
  metadata?: Partial<Record<string, unknown>>;
  user?: Pick<ErpUser, 'id' | 'username' | 'roles'>;
  method?: string;
  routePath?: string;
  ip?: string;

  readOnlyUsernames?: readonly string[];
}

function buildContext(options: HarnessOptions): {
  guard: RolesGuard;
  context: ExecutionContext;
  request: AuthenticatedRequest;
  auth: { recordAuthorizationDenied: ReturnType<typeof vi.fn> };
} {
  const auth = {
    recordAuthorizationDenied: vi.fn().mockResolvedValue(undefined),
  };
  const reflector = new Reflector();
  vi.spyOn(reflector, 'getAllAndOverride').mockImplementation(
    (metadataKey: unknown) => (options.metadata ?? {})[metadataKey as string],
  );

  const request = {
    method: options.method ?? 'GET',
    path: '/example',
    route: { path: options.routePath ?? '/example' },
    erpUser: options.user as ErpUser | undefined,
    ...(options.ip === undefined ? {} : { ip: options.ip }),
  } as unknown as AuthenticatedRequest;

  const context = {
    switchToHttp: () => ({ getRequest: <T>() => request as T }),
    getHandler: () => vi.fn(),
    getClass: () => vi.fn(),
  } as unknown as ExecutionContext;

  const guard = new RolesGuard(
    auth as unknown as AuthenticationService,
    reflector,
    new Set(options.readOnlyUsernames ?? []),
  );
  return { guard, context, request, auth };
}

const aUser = (roles: readonly ErpRole[]): Pick<ErpUser, 'id' | 'username' | 'roles'> => ({
  id: 'user-1',
  username: 'jdoe',
  roles,
});

describe('RolesGuard', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('allows a @Public() route without touching user state or audit', async () => {
    const { guard, context, auth } = buildContext({ metadata: { [IS_PUBLIC_KEY]: true } });
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(auth.recordAuthorizationDenied).not.toHaveBeenCalled();
  });

  it('throws 401 if the request has no user (SessionGuard bypass never happened)', async () => {
    const { guard, context } = buildContext({ metadata: {}, user: undefined });
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('allows an @Authenticated() route regardless of the user roles (zero-roles OK)', async () => {
    const { guard, context, auth } = buildContext({
      metadata: { [IS_AUTHENTICATED_KEY]: true },
      user: aUser([]),
    });
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(auth.recordAuthorizationDenied).not.toHaveBeenCalled();
  });

  it('allows @RequireRoles when the user holds the required role', async () => {
    const { guard, context, auth } = buildContext({
      metadata: { [REQUIRED_ROLES_KEY]: ['Admin'] as readonly ErpRole[] },
      user: aUser(['Admin']),
    });
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(auth.recordAuthorizationDenied).not.toHaveBeenCalled();
  });

  it('allows @RequireRoles(A,B) any-of semantics — user holding B passes', async () => {
    const { guard, context } = buildContext({
      metadata: { [REQUIRED_ROLES_KEY]: ['Admin', 'Sales'] as readonly ErpRole[] },
      user: aUser(['Sales']),
    });
    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('denies @RequireRoles when the user has none of the required roles — 403 + audit', async () => {
    const { guard, context, auth } = buildContext({
      metadata: { [REQUIRED_ROLES_KEY]: ['Admin'] as readonly ErpRole[] },
      user: aUser(['Sales']),
      method: 'POST',
      routePath: '/admin/users',
      ip: '192.0.2.5',
    });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ForbiddenException);
    expect(auth.recordAuthorizationDenied).toHaveBeenCalledTimes(1);
    expect(auth.recordAuthorizationDenied).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'user-1', username: 'jdoe' }),
      'POST /admin/users',
      ['Admin'],
      { sourceIp: '192.0.2.5' },
    );
  });

  it('denies a route with no authz decorator at all — fail-closed default + audit', async () => {
    const { guard, context, auth } = buildContext({
      metadata: {},
      user: aUser(['Sales']),
      routePath: '/orders/new',
    });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ForbiddenException);
    expect(auth.recordAuthorizationDenied).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'user-1' }),
      'GET /orders/new',
      [],
      expect.any(Object),
    );
  });

  it('denies an empty @RequireRoles() as if it were the default-deny path', async () => {
    const { guard, context, auth } = buildContext({
      metadata: { [REQUIRED_ROLES_KEY]: [] as readonly ErpRole[] },
      user: aUser(['Admin']),
    });
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ForbiddenException);
    expect(auth.recordAuthorizationDenied).toHaveBeenCalled();
  });

  it('audits with sourceIp omitted when the request has no ip', async () => {
    const { guard, context, auth } = buildContext({
      metadata: { [REQUIRED_ROLES_KEY]: ['Admin'] as readonly ErpRole[] },
      user: aUser([]),
    });
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ForbiddenException);

    expect(auth.recordAuthorizationDenied).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(String),
      expect.any(Array),
      {},
    );
  });
});

describe('RolesGuard and a read-only account', () => {
  const BOT = 'readonly-bot';
  const bot = (roles: readonly ErpRole[] = []): Pick<ErpUser, 'id' | 'username' | 'roles'> => ({
    id: 'user-bot',
    username: BOT,
    roles,
  });

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it.each(['GET', 'HEAD'])('allows %s, which is the whole point of the account', async (method) => {
    const { guard, context, auth } = buildContext({
      metadata: { [IS_AUTHENTICATED_KEY]: true },
      user: bot(),
      method,
      readOnlyUsernames: [BOT],
    });
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(auth.recordAuthorizationDenied).not.toHaveBeenCalled();
  });

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])(
    'refuses %s on an @Authenticated() route, which no role gate would have stopped',
    async (method) => {
      const { guard, context, auth } = buildContext({
        metadata: { [IS_AUTHENTICATED_KEY]: true },
        user: bot(),
        method,
        routePath: '/orders',
        readOnlyUsernames: [BOT],
      });
      await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ForbiddenException);
      expect(auth.recordAuthorizationDenied).toHaveBeenCalledTimes(1);
    },
  );

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])(
    'refuses %s on a role-gated route the account holds the role for — the list wins',
    async (method) => {
      const { guard, context } = buildContext({
        metadata: { [REQUIRED_ROLES_KEY]: ['Admin'] as readonly ErpRole[] },
        user: bot(['Admin']),
        method,
        routePath: '/admin/users',
        readOnlyUsernames: [BOT],
      });
      await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ForbiddenException);
    },
  );

  it('records the deny with a cause, not as a missing decorator', async () => {
    const { guard, context, auth } = buildContext({
      metadata: { [IS_AUTHENTICATED_KEY]: true },
      user: bot(),
      method: 'POST',
      routePath: '/orders',
      ip: '192.0.2.7',
      readOnlyUsernames: [BOT],
    });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ForbiddenException);
    expect(auth.recordAuthorizationDenied).toHaveBeenCalledWith(
      expect.objectContaining({ username: BOT }),
      'POST /orders',
      [],
      { sourceIp: '192.0.2.7' },
      'read-only account (READ_ONLY_USERS)',
    );
  });

  it.each(['POST', 'DELETE'])(
    'lets a @Public() route through on %s, so the account can still sign in and out',
    async (method) => {
      const { guard, context, auth } = buildContext({
        metadata: { [IS_PUBLIC_KEY]: true },
        user: bot(),
        method,
        routePath: '/auth/login',
        readOnlyUsernames: [BOT],
      });
      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(auth.recordAuthorizationDenied).not.toHaveBeenCalled();
    },
  );

  it('leaves an account that is not on the list alone', async () => {
    const { guard, context, auth } = buildContext({
      metadata: { [IS_AUTHENTICATED_KEY]: true },
      user: aUser([]),
      method: 'POST',
      readOnlyUsernames: [BOT],
    });
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(auth.recordAuthorizationDenied).not.toHaveBeenCalled();
  });

  it('changes nothing when the list is empty, which is the default', async () => {
    const { guard, context } = buildContext({
      metadata: { [IS_AUTHENTICATED_KEY]: true },
      user: bot(),
      method: 'POST',
      readOnlyUsernames: [],
    });
    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('matches the username the way sign-in does, so case and spacing cannot slip past', async () => {
    const { guard, context } = buildContext({
      metadata: { [IS_AUTHENTICATED_KEY]: true },
      user: bot(),
      method: 'POST',
      readOnlyUsernames: ['readonly-bot'],
    });
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('resolveReadOnlyUsernames', () => {
  it.each([
    ['unset', undefined],
    ['empty', ''],
  ])('names nobody when the variable is %s', (_label, value) => {
    const env = (value === undefined ? {} : { READ_ONLY_USERS: value }) as NodeJS.ProcessEnv;
    expect(resolveReadOnlyUsernames(env).size).toBe(0);
  });

  it('splits on commas and normalizes each name the way sign-in does', () => {
    const resolved = resolveReadOnlyUsernames({
      READ_ONLY_USERS: ' READONLY-Bot , reports-bot ',
    } as NodeJS.ProcessEnv);
    expect([...resolved].sort()).toEqual(['readonly-bot', 'reports-bot']);
  });

  it('drops empty entries rather than refusing an account with no name', () => {
    const resolved = resolveReadOnlyUsernames({
      READ_ONLY_USERS: 'readonly-bot,,',
    } as NodeJS.ProcessEnv);
    expect([...resolved]).toEqual(['readonly-bot']);
  });

  it('accepts the account name the demonstration passes', () => {
    const resolved = resolveReadOnlyUsernames({
      READ_ONLY_USERS: 'dev-sales',
    } as NodeJS.ProcessEnv);
    expect([...resolved]).toEqual(['dev-sales']);
  });

  it.each([
    ['a principal name', 'audit.viewer@example.test'],
    ['a down-level name', 'EXAMPLE\\audit.viewer'],
  ])(
    'stops the API at start when an entry is %s, which no sign-in is ever stored under',
    (_label, entry) => {
      const env = { READ_ONLY_USERS: `reports-bot, ${entry}` } as NodeJS.ProcessEnv;
      expect(() => resolveReadOnlyUsernames(env)).toThrow(
        `READ_ONLY_USERS entry "${entry}" is not an account name: write the account's sAMAccountName on its own, without a domain`,
      );
    },
  );
});
