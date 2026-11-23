// Smoke test: every block type renders to a real PDF without a browser.
import { describe, expect, it } from 'vitest';
import { ReactPdfDocumentRenderer } from '../src/adapters/react-pdf/react-pdf-renderer';
import type { DocumentModel } from '../src/document-model';

const everyBlock: DocumentModel = {
  title: 'Renderer smoke',
  blocks: [
    {
      type: 'letterhead',
      nameLines: ['ACME', 'PAPER GOODS'],
      detailLines: ['P.O. BOX 1 ANYTOWN, ID 83990', 'TELEPHONE (202) 555-0150'],
    },
    { type: 'heading', title: 'Quote', subtitle: 'Q-0517 · v1' },
    { type: 'keyValues', rows: [{ label: 'Customer', value: 'Acme Papers' }] },
    {
      type: 'lineItems',
      columns: [
        { key: 'description', label: 'Description' },
        { key: 'extended', label: 'Extended', align: 'right' },
      ],
      rows: [{ description: '24" × 1175ft', extended: '$1,000.00' }],
    },
    { type: 'notice', tone: 'warning', text: 'Freight still to be confirmed.' },
    { type: 'notice', tone: 'info', text: 'Left.' },
    { type: 'totals', rows: [{ label: 'Total', value: '$1,000.00', emphasis: true }] },
    { type: 'prose', heading: 'Notes', text: 'Delivery week of the 14th.' },
  ],
  footer: 'Quote Q-0517 · v1',
};

describe('ReactPdfDocumentRenderer', () => {
  it('renders every block type to a real PDF without a browser', async () => {
    const bytes = await new ReactPdfDocumentRenderer().render(everyBlock);

    expect(Buffer.from(bytes.subarray(0, 5)).toString('latin1')).toBe('%PDF-');
    expect(bytes.byteLength).toBeGreaterThan(1000);
  });
});
