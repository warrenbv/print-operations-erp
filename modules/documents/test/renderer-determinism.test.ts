// Pins that the renderer is not byte-deterministic. Two renders match in size but not in digest, so a
// stored checksum identifies a file and cannot detect whether content changed.
import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { ReactPdfDocumentRenderer } from '../src/adapters/react-pdf/react-pdf-renderer';
import type { DocumentModel } from '../src/document-model';

describe('the PDF renderer is not byte-deterministic', () => {
  const model: DocumentModel = {
    title: 'Order Confirmation',
    blocks: [
      { type: 'heading', title: 'Order Confirmation', subtitle: 'DPW-1' },
      { type: 'keyValues', rows: [{ label: 'Customer', value: 'Acme' }] },
    ],
    footer: 'Demo Printworks',
  };

  it('renders one model twice to the same size and a different digest', async () => {
    const renderer = new ReactPdfDocumentRenderer();

    const first = await renderer.render(model);
    const second = await renderer.render(model);

    const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

    expect(second.byteLength).toBe(first.byteLength);

    expect(digest(second)).not.toBe(digest(first));
  }, 60_000);
});
