// Census: every `reason` token the API raises has a gloss in apps/web/src/lib/api-error.ts.
// It parses apps/api/src for `reason` properties inside `new …Exception(…)` calls, and also checks each gloss fits the 200-character banner cut.
// A failure means a person would see a raw token. Add the gloss rather than an exception to this test.
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { REASON_GLOSS } from './api-error';

const ROOT = resolve(__dirname, '../../../..');
const API_SRC = join(ROOT, 'apps/api/src');

const TOKEN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === 'test' || entry.name === 'node_modules' ? [] : sourceFiles(full);
    }
    if (!entry.isFile() || !full.endsWith('.ts') || full.endsWith('.d.ts')) return [];
    return full.endsWith('.test.ts') ? [] : [full];
  });
}

function parse(file: string): ts.SourceFile {
  return ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
}

function emittedReasons(file: string): Map<string, string> {
  const found = new Map<string, string>();

  const collect = (node: ts.Node): void => {
    if (
      ts.isPropertyAssignment(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'reason'
    ) {
      const branches = ts.isConditionalExpression(node.initializer)
        ? [node.initializer.whenTrue, node.initializer.whenFalse]
        : [node.initializer];
      for (const branch of branches) {
        if (ts.isStringLiteral(branch) && TOKEN.test(branch.text)) found.set(branch.text, file);
      }
    }
    ts.forEachChild(node, collect);
  };

  const visit = (node: ts.Node): void => {
    if (
      ts.isNewExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text.endsWith('Exception')
    ) {
      for (const argument of node.arguments ?? []) collect(argument);
    }
    ts.forEachChild(node, visit);
  };

  visit(parse(file));
  return found;
}

function everyEmittedReason(): Map<string, string> {
  const all = new Map<string, string>();

  for (const file of sourceFiles(API_SRC)) {
    for (const [token, where] of emittedReasons(file)) all.set(token, where);
  }
  return all;
}

describe('REASON_GLOSS covers the edge', () => {
  it('finds the tokens at all, so a silent empty census cannot pass', () => {
    const tokens = [...everyEmittedReason().keys()];

    expect(tokens.length).toBeGreaterThan(40);
    for (const token of ['unsupported-document-type']) {
      expect(tokens, token).toContain(token);
    }
  });

  it('glosses every one of them', () => {
    const missing = [...everyEmittedReason()]
      .filter(([token]) => REASON_GLOSS[token] === undefined)
      .map(([token, file]) => `${token} (${relative(ROOT, file)})`);

    expect(missing).toEqual([]);
  });

  it('tells a person the attachment must be a PDF', () => {
    expect(REASON_GLOSS['unsupported-document-type']).toContain('PDF');
  });

  it('keeps every gloss short enough to survive the 200-character truncation', () => {
    for (const [token, gloss] of Object.entries(REASON_GLOSS)) {
      expect(gloss.length, token).toBeLessThanOrEqual(200);
    }
  });
});
