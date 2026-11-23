// Structural census: every id literal in an in-memory adapter, modules/*/src/adapters/in-memory/, is shaped like a UUID.
// The rule: both adapters accept the same data, and every id column is uuid. An id only memory accepts hides a failure until the database runs.
// A failure names the file and property. Mint the id with `newId()` or a UUID-shaped literal, or add it to NOT_A_UUID with the reason.
// A stale exemption fails as well. Background: docs/process/verifying-agent-written-code.md.
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const MODULES = resolve(__dirname, '../../../modules');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const NOT_A_UUID: ReadonlyMap<string, string> = new Map();

interface IdLiteral {
  readonly key: string;
  readonly text: string;

  readonly ok: boolean;
}

function inMemoryFiles(): { module: string; file: string; path: string }[] {
  const found: { module: string; file: string; path: string }[] = [];
  for (const module of readdirSync(MODULES)) {
    const dir = join(MODULES, module, 'src', 'adapters', 'in-memory');
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const file of entries.filter((e) => e.endsWith('.ts'))) {
      found.push({ module, file, path: join(dir, file) });
    }
  }
  return found;
}

function templateIsUuidShaped(node: ts.TemplateExpression): boolean {
  if (node.templateSpans.length !== 1) {
    return false;
  }
  const head = node.head.text;
  const tail = node.templateSpans[0]?.literal.text ?? '';
  if (!/^[0-9a-f-]*$/i.test(head) || !/^[0-9a-f-]*$/i.test(tail)) {
    return false;
  }
  const filler = 36 - head.length - tail.length;
  if (filler < 1) {
    return false;
  }
  return UUID.test(`${head}${'a'.repeat(filler)}${tail}`);
}

function idLiterals(): IdLiteral[] {
  const found: IdLiteral[] = [];

  for (const { module, file, path } of inMemoryFiles()) {
    const source = ts.createSourceFile(
      path,
      readFileSync(path, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
    );

    const record = (property: string, node: ts.Node): void => {
      const key = `${module}/${file} ${property}`;
      if (ts.isStringLiteralLike(node)) {
        found.push({ key, text: node.text, ok: UUID.test(node.text) });
      } else if (ts.isTemplateExpression(node)) {
        found.push({ key, text: node.getText(source), ok: templateIsUuidShaped(node) });
      }
    };

    const visit = (node: ts.Node): void => {
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        /_IDS?$/.test(node.name.text) &&
        node.initializer !== undefined
      ) {
        const constant = node.name.text;
        ts.forEachChild(node.initializer, function collect(inner: ts.Node): void {
          if (ts.isPropertyAssignment(inner)) {
            record(`${constant}.${inner.name.getText(source)}`, inner.initializer);
          }
          ts.forEachChild(inner, collect);
        });
        return;
      }

      if (ts.isPropertyAssignment(node)) {
        const name = node.name.getText(source).replace(/^['"`]|['"`]$/g, '');
        if (name === 'id' || /Id$/.test(name)) {
          record(name, node.initializer);
        }
      }

      ts.forEachChild(node, visit);
    };

    visit(source);
  }

  return found;
}

describe('every in-memory id is a uuid', () => {
  const literals = idLiterals();

  it('finds the in-memory adapters to check', () => {
    expect(inMemoryFiles().length).toBeGreaterThan(10);
    expect(literals.length).toBeGreaterThan(0);
  });

  it('has no id literal that the database could not store', () => {
    const bad = literals
      .filter((l) => !l.ok && !NOT_A_UUID.has(l.key))
      .map(
        (l) =>
          `${l.key} = ${l.text} is not UUID-shaped, and every id column is uuid. ` +
          'Mint it with newId(), or use a counted literal like ' +
          '`01988a00-0417-7000-8000-${String(n).padStart(12, "0")}`. An id that genuinely ' +
          'cannot be a UUID needs a line in NOT_A_UUID in this file saying why.',
      );

    expect(bad).toEqual([]);
  });

  it('has no stale exemption', () => {
    const live = new Set(literals.filter((l) => !l.ok).map((l) => l.key));
    const stale = [...NOT_A_UUID.keys()]
      .filter((key) => !live.has(key))
      .map((key) => `${key} is UUID-shaped now, or is gone - delete its line from NOT_A_UUID.`);

    expect(stale).toEqual([]);
  });
});
