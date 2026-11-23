// Structural census: runs `RolesGuard` from apps/api/src/auth/roles.guard.ts against every declared route, as an account named in READ_ONLY_USERS.
// The rule: that account reads every GET, reaches the public routes so it can sign in and out, and is refused every other route whatever its tier.
// The account holds Admin here, so a refusal comes from the read-only rule and not from a missing role.
// A failure names the route and its tier. apps/api/test/read-only-account.e2e.test.ts shows the same rule over HTTP.
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';

import type { AuthenticationService, ErpUser } from '@erp/identity';
import type { ErpRole } from '@erp/types';
import type { ExecutionContext } from '@nestjs/common';
import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';

import { RolesGuard } from '../src/auth/roles.guard';
import type { AuthenticatedRequest } from '../src/auth/session.guard';
import {
  IS_AUTHENTICATED_KEY,
  IS_PUBLIC_KEY,
  REQUIRED_ROLES_KEY,
} from '../src/auth/authz.decorators';

const API_SRC = resolve(__dirname, '../src');
const HTTP_METHODS = new Set(['Get', 'Post', 'Put', 'Patch', 'Delete']);

type Authz = 'roles' | 'authenticated' | 'public' | 'none';

interface Route {
  readonly file: string;
  readonly verb: string;
  readonly path: string;
  readonly authz: Authz;
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return entry.isFile() && full.endsWith('.ts') && !full.endsWith('.d.ts') ? [full] : [];
  });
}

function parse(file: string): ts.SourceFile {
  return ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.ESNext, true);
}

function decoratorCalls(node: ts.HasDecorators): ts.CallExpression[] {
  return (ts.getDecorators(node) ?? [])
    .map((decorator) => decorator.expression)
    .filter((expression): expression is ts.CallExpression => ts.isCallExpression(expression));
}

function literalText(node: ts.Expression | undefined): string {
  if (node === undefined) return '';
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  return node.getText();
}

function routes(): Route[] {
  const found: Route[] = [];

  for (const file of sourceFiles(API_SRC)) {
    const visit = (node: ts.Node): void => {
      if (ts.isClassDeclaration(node)) {
        let base = '';
        let classGate = false;
        for (const call of decoratorCalls(node)) {
          const name = call.expression.getText();
          if (name === 'Controller') base = literalText(call.arguments[0]);
          if (name === 'RequireRoles') classGate = true;
        }

        for (const member of node.members) {
          if (!ts.isMethodDeclaration(member)) continue;
          let verb: string | undefined;
          let sub = '';
          let gate = false;
          let authenticated = false;
          let isPublic = false;
          for (const call of decoratorCalls(member)) {
            const name = call.expression.getText();
            if (HTTP_METHODS.has(name)) {
              verb = name.toUpperCase();
              sub = literalText(call.arguments[0]);
            }
            if (name === 'RequireRoles') gate = true;
            if (name === 'Authenticated') authenticated = true;
            if (name === 'Public') isPublic = true;
          }
          if (verb === undefined) continue;

          const applied = gate || classGate;
          found.push({
            file,
            verb,
            path: `/${[base, sub].filter(Boolean).join('/')}`,
            authz: applied
              ? 'roles'
              : authenticated
                ? 'authenticated'
                : isPublic
                  ? 'public'
                  : 'none',
          });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(parse(file));
  }

  return found;
}

const ALL_ROUTES = routes();
const short = (route: Route): string =>
  `${route.verb} ${route.path} [${route.authz}] (${route.file.split(`${sep}src${sep}`)[1] ?? route.file})`;

const READ_ONLY_USER = 'readonly-bot';

async function answerFor(route: Route): Promise<'allowed' | 'refused'> {
  const auth = { recordAuthorizationDenied: vi.fn().mockResolvedValue(undefined) };
  const metadata: Record<string, unknown> = {
    ...(route.authz === 'public' ? { [IS_PUBLIC_KEY]: true } : {}),
    ...(route.authz === 'authenticated' ? { [IS_AUTHENTICATED_KEY]: true } : {}),
    ...(route.authz === 'roles' ? { [REQUIRED_ROLES_KEY]: ['Admin'] as readonly ErpRole[] } : {}),
  };

  const reflector = new Reflector();
  vi.spyOn(reflector, 'getAllAndOverride').mockImplementation(
    (metadataKey: unknown) => metadata[metadataKey as string],
  );

  const request = {
    method: route.verb,
    path: route.path,
    route: { path: route.path },
    erpUser: {
      id: 'user-bot',
      username: READ_ONLY_USER,
      roles: ['Admin'] as readonly ErpRole[],
    } as ErpUser,
  } as unknown as AuthenticatedRequest;

  const context = {
    switchToHttp: () => ({ getRequest: <T>() => request as T }),
    getHandler: () => vi.fn(),
    getClass: () => vi.fn(),
  } as unknown as ExecutionContext;

  const guard = new RolesGuard(
    auth as unknown as AuthenticationService,
    reflector,
    new Set([READ_ONLY_USER]),
  );

  try {
    await guard.canActivate(context);
    return 'allowed';
  } catch (err) {
    expect(err).toBeInstanceOf(ForbiddenException);
    return 'refused';
  }
}

describe('the census can actually read the code', () => {
  it('found enough routes for the assertions below to mean something', () => {
    expect(ALL_ROUTES.length).toBeGreaterThanOrEqual(65);
    expect(ALL_ROUTES.filter((route) => route.verb !== 'GET').length).toBeGreaterThanOrEqual(24);
    expect(ALL_ROUTES.filter((route) => route.authz === 'public').length).toBeGreaterThanOrEqual(3);
  });

  it('still finds open authenticated writes, which are the reason for the rule', () => {
    const open = ALL_ROUTES.filter(
      (route) => route.verb !== 'GET' && route.authz === 'authenticated',
    );
    expect(open.length).toBeGreaterThanOrEqual(2);
  });
});

describe('a read-only account against every route the API declares', () => {
  it('is refused every non-GET route, whatever tier it declares', async () => {
    const allowed: string[] = [];
    for (const route of ALL_ROUTES) {
      if (route.verb === 'GET' || route.authz === 'public') continue;
      if ((await answerFor(route)) === 'allowed') allowed.push(short(route));
    }
    expect(allowed).toEqual([]);
  });

  it('still reads every GET, which is the whole point of the account', async () => {
    const refused: string[] = [];
    for (const route of ALL_ROUTES) {
      if (route.verb !== 'GET' || route.authz === 'none') continue;
      if ((await answerFor(route)) === 'refused') refused.push(short(route));
    }
    expect(refused).toEqual([]);
  });

  it('still reaches every @Public() route, so it can sign in and out', async () => {
    const refused: string[] = [];
    for (const route of ALL_ROUTES) {
      if (route.authz !== 'public') continue;
      if ((await answerFor(route)) === 'refused') refused.push(short(route));
    }
    expect(refused).toEqual([]);
  });
});
