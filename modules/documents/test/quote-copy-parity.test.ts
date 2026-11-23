// The quote PDF's wording against the fixture the review step's test also reads:
// apps/web/src/app/quoting/quotes/[id]/review/customer-copy.test.ts. A failure means the page and the
// PDF would show the customer different things. Change the fixture's `expected` only with both.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { LinePaper, QuoteTotals, QuoteWithLines } from '@erp/types';
import { describe, expect, it } from 'vitest';

import { DEMO_BRAND } from '../src/brands';
import type { DocumentModel } from '../src/document-model';
import { buildQuoteDocument } from '../src/templates/quote-document';

interface ParityCase {
  readonly name: string;
  readonly input: {
    readonly customerName: string;
    readonly salesRepName?: string;
    readonly quote: QuoteWithLines;
    readonly totals: QuoteTotals;

    readonly papers: Readonly<Record<string, LinePaper>>;
  };
  readonly expected: unknown;
}

const FIXTURE = resolve(__dirname, 'fixtures', 'quote-copy-parity.json');
const { cases } = JSON.parse(readFileSync(FIXTURE, 'utf8')) as { cases: ParityCase[] };

function copyOf(model: DocumentModel) {
  const letterhead = model.blocks.find((block) => block.type === 'letterhead');
  const keyValues = model.blocks.find((block) => block.type === 'keyValues');
  const lineItems = model.blocks.find((block) => block.type === 'lineItems');
  const totals = model.blocks.find((block) => block.type === 'totals');
  const prose = model.blocks.find((block) => block.type === 'prose');
  return {
    letterhead: {
      nameLines: letterhead?.type === 'letterhead' ? letterhead.nameLines : [],
      detailLines: letterhead?.type === 'letterhead' ? letterhead.detailLines : [],
    },
    title: model.title,
    rows: keyValues?.type === 'keyValues' ? keyValues.rows : [],
    columns:
      lineItems?.type === 'lineItems'
        ? lineItems.columns.map((column) => ({
            key: column.key,
            label: column.label,
            ...(column.align === 'right' ? { align: 'right' } : {}),
          }))
        : [],
    lines: lineItems?.type === 'lineItems' ? lineItems.rows : [],
    notices: model.blocks.flatMap((block) => (block.type === 'notice' ? [block.text] : [])),
    total:
      totals?.type === 'totals'
        ? { label: totals.rows[0]?.label, value: totals.rows[0]?.value }
        : undefined,
    ...(prose?.type === 'prose' ? { notes: prose.text } : {}),
  };
}

describe('the quote PDF, as the review step shows it', () => {
  it.each(cases.map((parity) => [parity.name, parity] as const))('%s', (_name, parity) => {
    const model = buildQuoteDocument({
      brand: DEMO_BRAND,
      quote: parity.input.quote,
      totals: parity.input.totals,
      customerName: parity.input.customerName,
      papers: new Map(Object.entries(parity.input.papers)),
      ...(parity.input.salesRepName === undefined
        ? {}
        : { salesRepName: parity.input.salesRepName }),
    });
    expect(copyOf(model)).toEqual(parity.expected);
  });
});
