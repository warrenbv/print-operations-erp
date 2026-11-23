// Structural check: every end-to-end test file that builds a Nest app applies the same request parsing the process
// applies at boot, and so does the boot file. The rule: how a query string and an empty body are read, and the refusal
// of a write from a foreign origin, are set in apps/api/src/config/request-parsing.ts, outside the modules, so an app
// built without it would handle requests differently from the running API and its tests would pass on behaviour no
// user gets.
// The source is parsed, so only a real call counts. A failure names the file: apply the parsing straight after the
// app is created, once for each app the file builds.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const TEST_DIR = __dirname;

// How many times a file calls a method or function of this name, wherever the call sits.
function callsTo(path: string, name: string): number {
  const source = ts.createSourceFile(
    path,
    readFileSync(path, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  let count = 0;
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const called = ts.isPropertyAccessExpression(callee)
        ? callee.name.text
        : ts.isIdentifier(callee)
          ? callee.text
          : undefined;
      if (called === name) count += 1;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return count;
}

const appTests = readdirSync(TEST_DIR)
  .filter((name) => name.endsWith('.ts'))
  .filter((name) => callsTo(join(TEST_DIR, name), 'createNestApplication') > 0);

describe('every app is built with the request parsing the process runs', () => {
  it('finds the e2e files that build an app', () => {
    expect(appTests.length).toBeGreaterThan(0);
  });

  it('applies it at boot', () => {
    expect(callsTo(join(TEST_DIR, '..', 'src', 'main.ts'), 'applyRequestParsing')).toBe(1);
  });

  it('carries the foreign-origin write refusal inside it', () => {
    const parsing = join(TEST_DIR, '..', 'src', 'config', 'request-parsing.ts');

    expect(callsTo(parsing, 'refuseForeignOriginWrites')).toBe(1);
  });

  it.each(appTests)('%s applies it to each app it builds', (name) => {
    const path = join(TEST_DIR, name);

    expect(callsTo(path, 'applyRequestParsing')).toBe(callsTo(path, 'createNestApplication'));
  });
});
