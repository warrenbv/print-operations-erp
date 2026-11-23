// Structural census: every path parameter on every controller uses `UuidParam` from apps/api/src/params.decorators.ts.
// The rule: a malformed id is answered 404 at the edge. Unvalidated, it reaches a uuid column in PostgreSQL and answers 500, which in-memory tests cannot see.
// A failure names the route and parameter. Use `UuidParam`, or add the parameter to NOT_A_UUID with the reason it is not a UUID.
// The list can only shrink: an entry whose route now uses `UuidParam`, or no longer exists, fails too. Background: docs/process/verifying-agent-written-code.md.
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const API_SRC = resolve(__dirname, '../src');

const HTTP_METHODS = new Set(['Get', 'Post', 'Put', 'Patch', 'Delete']);

const NOT_A_UUID: ReadonlyMap<string, string> = new Map([
  [
    'PUT /admin/users/:externalId/roles externalId',
    'the external id the identity provider issues for a user, which this database does not mint',
  ],
  ['PATCH /quoting/tiers/:code code', 'a pricing tier code, chosen by the Billing Manager'],
  [
    'GET /quoting/tax-rates/:jurisdiction/history jurisdiction',
    'a WA DOR location code such as WA-0202',
  ],
]);

interface PathParam {
  readonly key: string;
  readonly route: string;
  readonly name: string;
  readonly decorator: string;
  readonly file: string;
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return entry.name.endsWith('.controller.ts') ? [full] : [];
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

function relativeTo(root: string, file: string): string {
  return (file.split(root + sep)[1] ?? file).split(sep).join('/');
}

function pathParams(): PathParam[] {
  const found: PathParam[] = [];
  for (const file of sourceFiles(API_SRC)) {
    const visit = (node: ts.Node): void => {
      if (ts.isClassDeclaration(node)) {
        let base = '';
        for (const call of decoratorCalls(node)) {
          if (call.expression.getText() === 'Controller') base = literalText(call.arguments[0]);
        }
        for (const member of node.members) {
          if (!ts.isMethodDeclaration(member)) continue;
          let verb: string | undefined;
          let sub = '';
          for (const call of decoratorCalls(member)) {
            const name = call.expression.getText();
            if (HTTP_METHODS.has(name)) {
              verb = name.toUpperCase();
              sub = literalText(call.arguments[0]);
            }
          }
          if (verb === undefined) continue;
          const route = `${verb} /${[base, sub].filter(Boolean).join('/')}`;
          for (const parameter of member.parameters) {
            for (const call of decoratorCalls(parameter)) {
              const decorator = call.expression.getText();
              if (decorator !== 'Param' && decorator !== 'UuidParam') continue;
              const name = literalText(call.arguments[0]);
              found.push({
                key: `${route} ${name}`,
                route,
                name,
                decorator,
                file: relativeTo('src', file),
              });
            }
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(parse(file));
  }
  return found;
}

const PARAMS = pathParams();

describe('every id path parameter is validated as a UUID', () => {
  it('finds path parameters at all, so the checks below cannot pass by parsing nothing', () => {
    expect(PARAMS.length).toBeGreaterThan(17);
    expect(PARAMS.filter((p) => p.decorator === 'UuidParam').length).toBeGreaterThan(17);
  });

  it('uses UuidParam for every path parameter that is not listed as an exception', () => {
    const unguarded = PARAMS.filter((p) => p.decorator === 'Param' && !NOT_A_UUID.has(p.key)).map(
      (p) =>
        `${p.key} (${p.file}) - a path id reaches Postgres unvalidated and answers 500 on a ` +
        'malformed value. Use @UuidParam, or add a line to NOT_A_UUID in this file saying why ' +
        'this parameter is not a UUID.',
    );
    expect(unguarded).toEqual([]);
  });

  it('drops an exception once the route stops needing it', () => {
    const guarded = new Set(PARAMS.filter((p) => p.decorator === 'Param').map((p) => p.key));
    const stale = [...NOT_A_UUID.keys()]
      .filter((key) => !guarded.has(key))
      .map((key) => `${key} no longer uses a plain @Param - delete its line from NOT_A_UUID.`);
    expect(stale).toEqual([]);
  });

  it('keeps every exception a real route', () => {
    const routes = new Set(PARAMS.map((p) => p.route));
    const orphaned = [...NOT_A_UUID.keys()]
      .filter((key) => !routes.has(key.slice(0, key.lastIndexOf(' '))))
      .map((key) => `${key} is no longer a route - delete its line from NOT_A_UUID.`);
    expect(orphaned).toEqual([]);
  });
});
