// Structural test. The rule: every page with a file input answers a post over the 50 MB body limit with
// that page and a message, through apps/web/src/middleware.ts and `TOO_LARGE_PAGES` in apps/web/src/lib/post-too-large.ts.
// How it finds them: it walks apps/web/src/app, counts file inputs in each source file with comments stripped,
// and maps each file to the route of the nearest page.tsx above it. The expected files are listed, so the
// test also fails if the search stops finding boxes.
// A failure means a page has a file box that `TOO_LARGE_PAGES` does not name, or the list names a page without one.
// The layer of checks this belongs to: docs/process/verifying-agent-written-code.md.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

import { describe, expect, it } from 'vitest';

import { TOO_LARGE_PAGES, tooLargePageAt } from '../lib/post-too-large';

const APP = resolve(__dirname);

const MADE_UP_ID = '0198a000-0000-7000-8000-000000000841';

function sources(folder: string): string[] {
  return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

function code(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/^\s*\/\*[\s\S]*?\*\//gm, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

function fileBoxes(path: string): number {
  return (code(path).match(/\btype=(?:"file"|'file'|\{\s*['"]file['"]\s*\})/g) ?? []).length;
}

function routeOf(path: string): string | undefined {
  let folder = dirname(path);
  while (folder.startsWith(APP)) {
    if (existsSync(join(folder, 'page.tsx'))) {
      const segments = relative(APP, folder)
        .split(sep)
        .filter((segment) => segment !== '' && !/^\(.*\)$/.test(segment))
        .map((segment) => (/^\[.*\]$/.test(segment) ? MADE_UP_ID : segment));
      return `/${segments.join('/')}`;
    }
    folder = dirname(folder);
  }
  return undefined;
}

const BOXES = sources(APP).flatMap((path) =>
  Array.from({ length: fileBoxes(path) }, () => ({
    file: relative(APP, path).split(sep).join('/'),
    route: routeOf(path),
  })),
);

describe('every file box', () => {
  it('is counted, so the census fails loudly if it stops finding them', () => {
    expect(BOXES.map((box) => box.file).sort()).toEqual([
      'orders/[id]/components/purchase-order.tsx',
      'quoting/quotes/[id]/convert/page.tsx',
      'quoting/tax-rates/page.tsx',
    ]);
  });

  for (const { file, route } of BOXES) {
    it(`${file}: its page is answered over 50 MB`, () => {
      expect(route, `${file} is drawn on no page`).toBeDefined();
      expect(
        tooLargePageAt(route ?? ''),
        `${file} is on ${String(route)}, which TOO_LARGE_PAGES does not name`,
      ).toBeDefined();
    });
  }

  it('leaves no page in the list without a file box', () => {
    const routes = BOXES.map((box) => box.route ?? '');
    for (const page of TOO_LARGE_PAGES) {
      expect(
        routes.some((route) => page.shape.test(route)),
        `${String(page.shape)} has no file box`,
      ).toBe(true);
    }
  });
});
