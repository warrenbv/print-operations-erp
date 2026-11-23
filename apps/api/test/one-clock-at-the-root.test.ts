// Structural check: apps/api/src reads real time only through apps/api/src/test-clock.ts, or where REAL_TIME_IS_CORRECT_HERE says why.
// It counts `new Date()` with no arguments, `Date.now` and uses of `systemClock`. A failure means a new real-time read.
// Route it through `apiClock`, or add an entry with its reason and its count.
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const API_SRC = resolve(__dirname, '../src');

const THE_CLOCK_ITSELF = join('apps', 'api', 'src', 'test-clock.ts');

const REAL_TIME_IS_CORRECT_HERE: ReadonlyMap<string, { reads: number; why: string }> = new Map([
  [
    'auth/auth.factory.ts',
    {
      reads: 2,
      why: 'session idle and absolute expiry — a journey that moves the business clock forward must not expire its own session mid-test and land on /login',
    },
  ],
  [
    'health/health.controller.ts',
    {
      reads: 1,
      why: 'the liveness timestamp says when this process answered, which is a fact about the machine and never a business day',
    },
  ],
]);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.isFile() && path.endsWith('.ts') ? [path] : [];
  });
}

function realTimeReads(path: string): number {
  const source = ts.createSourceFile(
    path,
    readFileSync(path, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );

  let reads = 0;
  const visit = (node: ts.Node): void => {
    if (
      ts.isNewExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'Date' &&
      (node.arguments === undefined || node.arguments.length === 0)
    ) {
      reads += 1;
    }
    if (
      ts.isPropertyAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'Date' &&
      node.name.text === 'now'
    ) {
      reads += 1;
    }
    if (ts.isIdentifier(node) && node.text === 'systemClock') {
      reads += 1;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return reads;
}

describe('the API composition root', () => {
  it('reads real time only where an entry says why', () => {
    const found = new Map<string, number>();
    for (const path of sourceFiles(API_SRC)) {
      if (path.endsWith(THE_CLOCK_ITSELF)) continue;
      const reads = realTimeReads(path);
      if (reads > 0) {
        found.set(relative(API_SRC, path).split(sep).join('/'), reads);
      }
    }

    const expected = new Map(
      [...REAL_TIME_IS_CORRECT_HERE].map(([file, entry]) => [file, entry.reads] as const),
    );

    expect(Object.fromEntries([...found].sort())).toEqual(Object.fromEntries([...expected].sort()));
  });
});
