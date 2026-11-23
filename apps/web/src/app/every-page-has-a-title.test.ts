// Structural test. The rule: every page sets its own title through a static `metadata` export or
// `generateMetadata`, not both, and the root layout adds the application name through one template.
// How it finds them: it parses every page.tsx under apps/web/src/app with the TypeScript compiler and reads
// its exports. A static title may not contain the application name or a long dash.
// The error boundary is a client component and cannot export metadata, so its title element is checked instead.
// A failure names the page that has no title or two. The layer: docs/process/verifying-agent-written-code.md.
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { APP_NAME, TITLE_TEMPLATE } from '../lib/titles';

const APP = resolve(__dirname);

function pageFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return pageFiles(path);
      return entry.name === 'page.tsx' ? [path] : [];
    })
    .sort();
}

function parse(file: string): ts.SourceFile {
  return ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
}

function isExported(node: ts.Node): boolean {
  return (
    ts.canHaveModifiers(node) &&
    (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
  );
}

function metadataExport(source: ts.SourceFile): ts.Expression | undefined {
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement) || !isExported(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.name.text === 'metadata') {
        return declaration.initializer;
      }
    }
  }
  return undefined;
}

function exportsGenerateMetadata(source: ts.SourceFile): boolean {
  return source.statements.some(
    (statement) =>
      ts.isFunctionDeclaration(statement) &&
      isExported(statement) &&
      statement.name?.text === 'generateMetadata',
  );
}

function literalTitle(metadata: ts.Expression): string | undefined {
  if (!ts.isObjectLiteralExpression(metadata)) return undefined;
  for (const property of metadata.properties) {
    if (
      ts.isPropertyAssignment(property) &&
      ts.isIdentifier(property.name) &&
      property.name.text === 'title' &&
      ts.isStringLiteralLike(property.initializer)
    ) {
      return property.initializer.text;
    }
  }
  return undefined;
}

const PAGES = pageFiles(APP);
const name = (file: string) => relative(APP, file).split('\\').join('/');

describe('every page has a title', () => {
  it('finds the pages', () => {
    expect(PAGES.length).toBeGreaterThanOrEqual(32);
  });

  it.each(PAGES.map((file) => [name(file), file]))(
    '%s exports metadata or generateMetadata, not both',
    (_label, file) => {
      const source = parse(file);
      const hasStatic = metadataExport(source) !== undefined;
      const hasDynamic = exportsGenerateMetadata(source);
      expect(hasStatic || hasDynamic).toBe(true);
      expect(hasStatic && hasDynamic).toBe(false);
    },
  );

  it('keeps the app name and dashes out of every static title', () => {
    const titles = PAGES.flatMap((file) => {
      const metadata = metadataExport(parse(file));
      const title = metadata === undefined ? undefined : literalTitle(metadata);
      return title === undefined ? [] : [[name(file), title] as const];
    });
    expect(titles.length).toBeGreaterThan(0);
    for (const [page, title] of titles) {
      expect(title.includes(APP_NAME), page).toBe(false);

      expect(/[\u2013\u2014]/.test(title), page).toBe(false);
    }
  });

  it('templates the title in the root layout', () => {
    const metadata = metadataExport(parse(join(APP, 'layout.tsx')));
    expect(metadata?.getText()).toContain('template: TITLE_TEMPLATE');
    expect(TITLE_TEMPLATE).toBe(`%s | ${APP_NAME}`);
  });

  it('titles the not-found boundary through metadata', () => {
    expect(metadataExport(parse(join(APP, 'not-found.tsx')))).toBeDefined();
  });

  it('titles the error boundary with a title element', () => {
    const text = readFileSync(join(APP, 'error.tsx'), 'utf8');
    expect(text).toMatch(/<title>\{fullTitle\(heading\)\}<\/title>/);
  });
});
