// Structural census of the authorization tier of every route in apps/api/src.
// The rules: every route declares a tier, every GET is open to any signed-in user except the Admin section, and writes stay role-gated: docs/product/roles.md.
// Role lists are resolved from packages/types/src/roles.ts, so a gate the parser cannot read fails instead of being skipped.
// A failure names the route and file. A new GET belongs behind `@Authenticated()`, not behind a gate that lists every role.
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const API_SRC = resolve(__dirname, '../src');
const SHARED_ROLES = resolve(__dirname, '../../../packages/types/src/roles.ts');

const HTTP_METHODS = new Set(['Get', 'Post', 'Put', 'Patch', 'Delete']);

type Authz = 'roles' | 'authenticated' | 'public' | 'none';

interface Route {
  readonly file: string;
  readonly verb: string;
  readonly path: string;

  readonly roles: readonly string[] | undefined;
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

function arrayMembers(node: ts.Node | undefined): string[] | undefined {
  if (node === undefined) return undefined;
  if (ts.isAsExpression(node) || ts.isParenthesizedExpression(node)) {
    return arrayMembers(node.expression);
  }
  if (!ts.isArrayLiteralExpression(node)) return undefined;

  return node.elements.map((element) => {
    if (ts.isStringLiteral(element)) return element.text;
    if (ts.isSpreadElement(element) && ts.isIdentifier(element.expression)) {
      return `...${element.expression.text}`;
    }

    return `?${element.getText()}`;
  });
}

function roleConstants(source: ts.SourceFile): Map<string, string[]> {
  const found = new Map<string, string[]>();
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text.endsWith('_ROLES')
    ) {
      const members = arrayMembers(node.initializer);
      if (members !== undefined) found.set(node.name.text, members);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

const sharedConstants = roleConstants(parse(SHARED_ROLES));

const files = sourceFiles(API_SRC);
const localConstants = new Map<string, Map<string, string[]>>(
  files.map((file) => [file, roleConstants(parse(file))]),
);

function resolveArgument(text: string, file: string): string[] {
  const name = text.replace(/^\.\.\./, '').trim();
  const literal = /^['"](.+)['"]$/.exec(name);
  if (literal?.[1] !== undefined) return [literal[1]];

  const list = localConstants.get(file)?.get(name) ?? sharedConstants.get(name);
  if (list === undefined) return [`UNRESOLVED(${name})`];
  return list.flatMap((member) =>
    member.startsWith('...') ? resolveArgument(member, file) : [member],
  );
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

  for (const file of files) {
    const source = parse(file);

    const visit = (node: ts.Node): void => {
      if (ts.isClassDeclaration(node)) {
        let base = '';
        let classGate: string[] | undefined;
        for (const call of decoratorCalls(node)) {
          const name = call.expression.getText();
          if (name === 'Controller') base = literalText(call.arguments[0]);
          if (name === 'RequireRoles') classGate = call.arguments.map((a) => a.getText());
        }

        for (const member of node.members) {
          if (!ts.isMethodDeclaration(member)) continue;
          let verb: string | undefined;
          let sub = '';
          let gate: string[] | undefined;
          let authenticated = false;
          let isPublic = false;
          for (const call of decoratorCalls(member)) {
            const name = call.expression.getText();
            if (HTTP_METHODS.has(name)) {
              verb = name.toUpperCase();
              sub = literalText(call.arguments[0]);
            }
            if (name === 'RequireRoles') gate = call.arguments.map((a) => a.getText());
            if (name === 'Authenticated') authenticated = true;
            if (name === 'Public') isPublic = true;
          }
          if (verb === undefined) continue;

          const applied = gate ?? classGate;
          const authz: Authz =
            applied !== undefined
              ? 'roles'
              : authenticated
                ? 'authenticated'
                : isPublic
                  ? 'public'
                  : 'none';
          found.push({
            file,
            verb,
            path: `/${[base, sub].filter(Boolean).join('/')}`,
            roles:
              applied === undefined
                ? undefined
                : [...new Set(applied.flatMap((argument) => resolveArgument(argument, file)))],
            authz,
          });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }

  return found;
}

const ALL_ROUTES = routes();
const short = (route: Route): string =>
  `${route.verb} ${route.path} (${route.file.split(`${sep}src${sep}`)[1] ?? route.file})`;

describe('the census can actually read the code', () => {
  it('resolves every gate it found, rather than skipping what it cannot parse', () => {
    const unresolved = ALL_ROUTES.filter((route) =>
      route.roles?.some((role) => role.startsWith('UNRESOLVED') || role.startsWith('?')),
    );
    expect(unresolved.map(short)).toEqual([]);
  });

  it('found the shared role constants and a plausible number of routes', () => {
    expect(sharedConstants.size).toBeGreaterThanOrEqual(13);
    expect(sharedConstants.get('QUOTE_LEAD_TIME_ROLES')).toContain('Production');
    expect(ALL_ROUTES.length).toBeGreaterThanOrEqual(65);
    expect(ALL_ROUTES.filter((r) => r.verb === 'GET').length).toBeGreaterThanOrEqual(36);
  });
});

describe('every role reads every GET route', () => {
  const EXEMPT: Record<string, string> = {
    '/admin/users': 'the Admin section is Admin-only',
    '/admin/roles': 'the Admin section is Admin-only',
  };

  const ALL_ROLES = sharedConstants.get('ERP_ROLES') ?? [];

  it('declares an authorization tier on every route, never leaving one to default-deny', () => {
    const undeclared = ALL_ROUTES.filter((route) => route.authz === 'none');
    expect(undeclared.map(short)).toEqual([]);
  });

  it('opens every GET with @Authenticated rather than a gate listing all five roles', () => {
    const gets = ALL_ROUTES.filter((route) => route.verb === 'GET');
    const notOpen = gets.filter(
      (route) =>
        route.authz !== 'authenticated' && route.authz !== 'public' && !(route.path in EXEMPT),
    );
    expect(notOpen.map(short)).toEqual([]);
  });

  it('leaves no GET route behind a role gate at all', () => {
    const gated = ALL_ROUTES.filter(
      (route) => route.verb === 'GET' && route.roles !== undefined && !(route.path in EXEMPT),
    );
    expect(gated.map(short)).toEqual([]);
  });

  it('admits every role to any GET gate that does come back', () => {
    const offenders: string[] = [];
    for (const route of ALL_ROUTES) {
      if (route.verb !== 'GET' || route.roles === undefined) continue;

      if (route.path in EXEMPT) continue;
      for (const role of ALL_ROLES) {
        if (!route.roles.includes(role)) offenders.push(`${short(route)} refuses ${role}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  describe('the exempted routes', () => {
    it('names only routes the API actually declares', () => {
      const declared = new Set(
        ALL_ROUTES.filter((route) => route.verb === 'GET').map((route) => route.path),
      );
      const orphaned = Object.keys(EXEMPT).filter((path) => !declared.has(path));
      expect(orphaned, 'exempted but not a declared GET route').toEqual([]);
    });

    it('gates every one of them to exactly Admin, so the exemption is not a hole', () => {
      const wrong = ALL_ROUTES.filter(
        (route) =>
          route.verb === 'GET' &&
          route.path in EXEMPT &&
          JSON.stringify(route.roles) !== JSON.stringify(['Admin']),
      ).map((route) => `${short(route)} is exempt but gated to ${JSON.stringify(route.roles)}`);
      expect(wrong).toEqual([]);
    });
  });

  it('found five roles and enough GETs for that to mean something', () => {
    expect(ALL_ROLES).toHaveLength(5);
    expect(ALL_ROUTES.filter((route) => route.verb === 'GET').length).toBeGreaterThan(31);
  });

  it('keeps the writes gated, which is the half the decision preserved', () => {
    const narrowWrites = ALL_ROUTES.filter(
      (route) =>
        route.verb !== 'GET' &&
        route.roles !== undefined &&
        ALL_ROLES.some((role) => !route.roles?.includes(role)),
    );
    expect(narrowWrites.length).toBeGreaterThan(0);
  });

  it('keeps granting a role to Admin alone, on its own decorator', () => {
    const grant = ALL_ROUTES.find((route) => route.path === '/admin/users/:externalId/roles');
    expect(grant?.roles).toEqual(['Admin']);

    const list = ALL_ROUTES.find((route) => route.path === '/admin/users' && route.verb === 'GET');
    expect(list?.roles).toEqual(['Admin']);
  });
});
