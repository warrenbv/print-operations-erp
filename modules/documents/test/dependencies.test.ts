// Structural check: received documents are stored as opaque bytes and never parsed, so this module
// may not depend on anything that could read one. See Received documents in docs/decisions/README.md.
// A failure means a dependency was added to modules/documents/package.json. Widen the allowed list only
// for a package that cannot reach a received document.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('documents module dependencies', () => {
  const pkg = JSON.parse(readFileSync(resolve(__dirname, '../package.json'), 'utf8')) as Record<
    string,
    Record<string, string>
  >;

  const ALLOWED_RUNTIME = new Set([
    '@erp/db',
    '@erp/types',
    '@react-pdf/renderer',
    'drizzle-orm',
    'react',
  ]);

  const ALLOWED_DEV = new Set([
    '@erp/config',
    '@types/node',
    '@types/react',
    'drizzle-kit',
    'typescript',
    'vitest',
  ]);

  it('has no dependency that could interpret a received document', () => {
    const unexpected = [
      ...Object.keys(pkg.dependencies ?? {}).filter((name) => !ALLOWED_RUNTIME.has(name)),
      ...Object.keys(pkg.devDependencies ?? {}).filter((name) => !ALLOWED_DEV.has(name)),
    ];

    expect(
      unexpected,
      `Unexpected dependency in @erp/documents: ${unexpected.join(', ')}.\n` +
        'Received documents are stored opaquely and never parsed. If this is a\n' +
        'parser, thumbnailer, OCR engine or transcoder, the answer is not to widen this\n' +
        'list: see Received documents in docs/decisions/README.md. If it is genuinely\n' +
        'unrelated, add it above with a note\n' +
        'saying why it cannot reach a received document.\n' +
        'Both sets are checked: a devDependency does not ship, but it is importable\n' +
        'from `src` by accident.',
    ).toEqual([]);
  });

  it('pins the render engine as the only document library present', () => {
    const all = [...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})];
    const readers = all.filter((name) =>
      /pdf-parse|pdfjs|pdf2|mammoth|^xlsx$|exceljs|node-xlsx|sharp|jimp|canvas|tesseract|imagemagick|gm|unzipper|adm-zip|jszip|officeparser|textract|libreoffice/i.test(
        name,
      ),
    );

    expect(
      readers,
      `A document-reading library is present in @erp/documents: ${readers.join(', ')}.`,
    ).toEqual([]);
  });
});
