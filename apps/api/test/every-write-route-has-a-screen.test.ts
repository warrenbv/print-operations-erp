// Structural census: every API route has a caller in apps/web. Every write has a page action and every GET a page that reads it.
// The rule: an act is done only when a person can perform it in the browser: docs/process/definition-of-done.md.
// It parses the controllers and the web app's fetch helpers. A failure names a route with no caller, or a web call to a route that does not exist.
// An exception needs an allowlist line whose reason reads "system-only <why>". Both lists are empty and can only shrink.
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const API_SRC = resolve(__dirname, '../src');
const WEB_SRC = resolve(__dirname, '../../web/src');

const HTTP_METHODS = new Set(['Get', 'Post', 'Put', 'Patch', 'Delete']);

const HOLE = '<>';

const HELPER_DEFINITIONS = [
  'lib/api-fetch.ts',
  'lib/fetch-parsed.ts',
  'lib/load-panel.ts',
  'lib/record-title.ts',
].map((relative) => relative.split('/').join(sep));

const API_HELPERS = new Set(['apiFetch', 'fetchParsed', 'loadPanel', 'recordRead', 'recordTitle']);

const SCHEMA_HELPERS = new Set(['fetchParsed', 'loadPanel', 'recordRead', 'recordTitle']);

interface Route {
  readonly verb: string;
  readonly path: string;
  readonly file: string;
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    if (!entry.isFile() || full.endsWith('.d.ts')) return [];
    return full.endsWith('.ts') || full.endsWith('.tsx') ? [full] : [];
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

function routes(): Route[] {
  const found: Route[] = [];
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
          found.push({
            verb,
            path: `/${[base, sub].filter(Boolean).join('/')}`,
            file: relativeTo('src', file),
          });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(parse(file));
  }
  return found;
}

function routePattern(path: string): string {
  return `/${path
    .split('/')
    .filter(Boolean)
    .map((segment) => (segment.startsWith(':') ? '{}' : segment))
    .join('/')}`;
}

interface CallSite {
  readonly method: string;
  readonly pattern: string;
  readonly raw: string;
  readonly file: string;
  readonly line: number;
}

const API_HOSTS = new Set(['API_BASE_URL', 'API_SERVER_URL']);
function callSites(): { sites: CallSite[]; unreadable: string[] } {
  const sites: CallSite[] = [];
  const unreadable: string[] = [];

  for (const file of sourceFiles(WEB_SRC)) {
    if (HELPER_DEFINITIONS.some((helper) => file.endsWith(helper))) continue;
    // A test that calls the API is not a screen, so it cannot stand in for one.
    if (/\.test\.tsx?$/.test(file)) continue;
    const source = parse(file);
    const shortFile = relativeTo('src', file);

    const constants = new Map<string, string[]>();
    const helpers = new Map<string, string[]>();

    const candidates = (node: ts.Expression | undefined, depth = 0): string[] | undefined => {
      if (node === undefined || depth > 6) return undefined;
      if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node)) {
        return candidates(node.expression, depth + 1);
      }
      if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return [node.text];
      if (ts.isConditionalExpression(node)) {
        const whenTrue = candidates(node.whenTrue, depth + 1);
        const whenFalse = candidates(node.whenFalse, depth + 1);
        if (whenTrue === undefined || whenFalse === undefined) return undefined;
        return [...whenTrue, ...whenFalse];
      }
      if (ts.isTemplateExpression(node)) {
        let built = [node.head.text];
        for (const span of node.templateSpans) {
          const isBase = ts.isIdentifier(span.expression) && API_HOSTS.has(span.expression.text);
          const pieces = isBase ? [''] : (candidates(span.expression, depth + 1) ?? [HOLE]);
          const next: string[] = [];
          for (const prefix of built) {
            for (const piece of pieces) next.push(prefix + piece + span.literal.text);
          }

          built = next.slice(0, 8);
        }
        return built;
      }
      if (ts.isIdentifier(node)) return constants.get(node.text);
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
        if (node.expression.text === 'encodeURIComponent') return [HOLE];
        return helpers.get(node.expression.text);
      }
      return undefined;
    };

    for (let pass = 0; pass < 3; pass += 1) {
      const collect = (node: ts.Node): void => {
        if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
          const resolved = candidates(node.initializer);
          if (resolved !== undefined) constants.set(node.name.text, resolved);
        }
        if (ts.isFunctionDeclaration(node) && node.name !== undefined && node.body !== undefined) {
          const [only] = node.body.statements;
          if (
            node.body.statements.length === 1 &&
            only !== undefined &&
            ts.isReturnStatement(only)
          ) {
            const resolved = candidates(only.expression);
            if (resolved !== undefined) helpers.set(node.name.text, resolved);
          }
        }
        ts.forEachChild(node, collect);
      };
      collect(source);
    }

    const webPattern = (raw: string): string =>
      `/${(raw.split('?')[0] ?? '')
        .split('/')
        .filter(Boolean)
        .map((segment) => (segment.includes(HOLE) ? '{}' : segment))
        .join('/')}`;

    const record = (method: string, raws: readonly string[], line: number): void => {
      for (const raw of raws) {
        if (!raw.startsWith('/')) continue;
        sites.push({
          method,
          pattern: webPattern(raw),
          raw: raw.split(HOLE).join('{}'),
          file: shortFile,
          line,
        });
      }
    };

    const visit = (node: ts.Node): void => {
      const line = source.getLineAndCharacterOfPosition(node.getStart()).line + 1;

      if (
        ts.isTemplateExpression(node) &&
        node.head.text === '' &&
        node.templateSpans[0] !== undefined &&
        ts.isIdentifier(node.templateSpans[0].expression) &&
        API_HOSTS.has(node.templateSpans[0].expression.text) &&
        !(ts.isCallExpression(node.parent) && node.parent.arguments[0] === node)
      ) {
        record('GET', candidates(node) ?? [], line);
      }

      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
        const callee = node.expression.text;
        if (API_HELPERS.has(callee) || callee === 'fetch') {
          let method = 'GET';
          const init = SCHEMA_HELPERS.has(callee) ? undefined : node.arguments[1];
          if (init !== undefined && ts.isObjectLiteralExpression(init)) {
            for (const property of init.properties) {
              if (
                ts.isPropertyAssignment(property) &&
                property.name.getText() === 'method' &&
                ts.isStringLiteral(property.initializer)
              ) {
                method = property.initializer.text;
              }
            }
          }
          const resolved = candidates(node.arguments[0]);
          if (resolved === undefined) {
            if (API_HELPERS.has(callee)) {
              unreadable.push(`${callee}(…) at ${shortFile}:${line}`);
            }
          } else {
            record(method, resolved, line);
          }
        }
      }

      ts.forEachChild(node, visit);
    };
    visit(source);
  }

  return { sites, unreadable };
}

const WRITE_ROUTES_WITH_NO_SCREEN: ReadonlyMap<string, string> = new Map([]);

const GET_ROUTES_WITH_NO_READER: ReadonlyMap<string, string> = new Map([]);

const REASON_SHAPE = /^system-only\b.+$/;

const ALL_ROUTES = routes();
const { sites: CALL_SITES, unreadable: UNREADABLE_CALLS } = callSites();

const CALLED = new Set(CALL_SITES.map((site) => `${site.method} ${site.pattern}`));
const DECLARED = new Set(ALL_ROUTES.map((route) => `${route.verb} ${routePattern(route.path)}`));

const key = (route: Route): string => `${route.verb} ${routePattern(route.path)}`;
const uncalled = (route: Route): boolean => !CALLED.has(key(route));

const WRITES = ALL_ROUTES.filter((route) => route.verb !== 'GET');
const GETS = ALL_ROUTES.filter((route) => route.verb === 'GET');

describe('the census can actually read the code', () => {
  it('resolves every path apps/web asks the fetch helpers for', () => {
    expect(UNREADABLE_CALLS).toEqual([]);
  });

  it('matches every path apps/web names to a route the API declares', () => {
    const orphans = CALL_SITES.filter(
      (site) => !DECLARED.has(`${site.method} ${site.pattern}`),
    ).map((site) => `${site.method} ${site.pattern} <- ${site.raw} (${site.file}:${site.line})`);
    expect([...new Set(orphans)]).toEqual([]);
  });

  it('gives every route a distinct pattern, so a match cannot be the wrong route', () => {
    const seen = new Map<string, string[]>();
    for (const route of ALL_ROUTES) {
      const entry = seen.get(key(route)) ?? [];
      entry.push(`${route.path} (${route.file})`);
      seen.set(key(route), entry);
    }
    const collisions = [...seen.entries()]
      .filter(([, paths]) => paths.length > 1)
      .map(([pattern, paths]) => `${pattern} <- ${paths.join(' | ')}`);
    expect(collisions).toEqual([]);
  });

  it('found enough routes and call sites for the census to mean anything', () => {
    expect(ALL_ROUTES.length).toBeGreaterThanOrEqual(65);
    expect(WRITES.length).toBeGreaterThanOrEqual(24);
    expect(CALL_SITES.length).toBeGreaterThanOrEqual(100);
  });
});

describe('every write route is reachable from a screen', () => {
  it('has a page action for every write route, or a listed reason', () => {
    const stranded = WRITES.filter(
      (route) => uncalled(route) && !WRITE_ROUTES_WITH_NO_SCREEN.has(key(route)),
    ).map(
      (route) =>
        `${route.verb} ${route.path} (${route.file}) - no apps/web caller. ` +
        'Add a page action that calls it, or add a line to WRITE_ROUTES_WITH_NO_SCREEN ' +
        'in this file saying why no person needs to call it.',
    );
    expect(stranded).toEqual([]);
  });

  it('drops a write route from the list once a page calls it', () => {
    const stale = [...WRITE_ROUTES_WITH_NO_SCREEN.keys()]
      .filter((entry) => CALLED.has(entry))
      .map(
        (entry) =>
          `${entry} now has an apps/web caller - delete its line from ` +
          'WRITE_ROUTES_WITH_NO_SCREEN in this file.',
      );
    expect(stale).toEqual([]);
  });

  it('keeps no line for a write route the API no longer declares', () => {
    const orphaned = [...WRITE_ROUTES_WITH_NO_SCREEN.keys()]
      .filter((entry) => !DECLARED.has(entry))
      .map((entry) => `${entry} is no longer a route - delete its line.`);
    expect(orphaned).toEqual([]);
  });
});

describe('every GET route is read by a page', () => {
  it('has a page reading every GET route, or a listed reason', () => {
    const unread = GETS.filter(
      (route) => uncalled(route) && !GET_ROUTES_WITH_NO_READER.has(key(route)),
    ).map(
      (route) =>
        `GET ${route.path} (${route.file}) - no apps/web reader. ` +
        'Read it from a page, or add a line to GET_ROUTES_WITH_NO_READER ' +
        'in this file saying why no person needs to read it.',
    );
    expect(unread).toEqual([]);
  });

  it('drops a GET route from the list once a page reads it', () => {
    const stale = [...GET_ROUTES_WITH_NO_READER.keys()]
      .filter((entry) => CALLED.has(entry))
      .map(
        (entry) =>
          `${entry} now has an apps/web reader - delete its line from ` +
          'GET_ROUTES_WITH_NO_READER in this file.',
      );
    expect(stale).toEqual([]);
  });

  it('keeps no line for a GET route the API no longer declares', () => {
    const orphaned = [...GET_ROUTES_WITH_NO_READER.keys()]
      .filter((entry) => !DECLARED.has(entry))
      .map((entry) => `${entry} is no longer a route - delete its line.`);
    expect(orphaned).toEqual([]);
  });
});

describe('the lists stay a record of decisions', () => {
  it('gives every listed route a system-only reason', () => {
    const malformed = [...WRITE_ROUTES_WITH_NO_SCREEN, ...GET_ROUTES_WITH_NO_READER]
      .filter(([, reason]) => !REASON_SHAPE.test(reason))
      .map(([route, reason]) => `${route}: "${reason}" - a reason must be "system-only <why>".`);
    expect(malformed).toEqual([]);
  });

  it('prints the census, so the size of the gap is visible and not only its shape', () => {
    const strandedWrites = WRITES.filter(uncalled);
    const unreadGets = GETS.filter(uncalled);
    process.stdout.write(
      [
        `[screen census] ${ALL_ROUTES.length} routes, ${CALL_SITES.length} apps/web call sites.`,
        `  writes: ${WRITES.length - strandedWrites.length}/${WRITES.length} have a page action.`,
        `  GETs:   ${GETS.length - unreadGets.length}/${GETS.length} are read by a page.`,
        ...strandedWrites.map((route) => `  no screen: ${route.verb} ${route.path}`),
        ...unreadGets.map((route) => `  no reader: GET ${route.path}`),
        '',
      ].join('\n'),
    );
    expect(strandedWrites.length + unreadGets.length).toBe(
      WRITE_ROUTES_WITH_NO_SCREEN.size + GET_ROUTES_WITH_NO_READER.size,
    );
  });
});
