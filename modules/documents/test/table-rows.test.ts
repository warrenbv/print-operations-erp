// The line table as drawn on the rendered PDF: rows per line, the column gutter, and where words wrap.
// Text positions come from modules/documents/test/pdf-runs.ts.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type {
  LinePaper,
  OrderTotals,
  OrderWithLines,
  QuoteTotals,
  QuoteWithLines,
} from '@erp/types';
import { describe, expect, it } from 'vitest';

import {
  LONGEST_UNBROKEN_WORD,
  ReactPdfDocumentRenderer,
} from '../src/adapters/react-pdf/react-pdf-renderer';
import { DEMO_BRAND } from '../src/brands';
import type { DocumentModel, LineItemsBlock } from '../src/document-model';
import { buildOrderConfirmationDocument } from '../src/templates/order-confirmation-document';
import { buildQuoteDocument } from '../src/templates/quote-document';
import { textRuns, type TextRun } from './pdf-runs';

const renderer = new ReactPdfDocumentRenderer();

async function rowsDrawn(block: LineItemsBlock): Promise<number> {
  const model: DocumentModel = { title: 'Rows', blocks: [block] };
  return new Set(textRuns(await renderer.render(model)).map(({ y }) => y)).size;
}

async function rowsOf(block: LineItemsBlock, index: number): Promise<number> {
  const row = block.rows[index];
  if (row === undefined) {
    throw new Error(`no line ${String(index)} in the table`);
  }
  return (await rowsDrawn({ ...block, rows: [row] })) - (await rowsDrawn({ ...block, rows: [] }));
}

function equalColumns(block: LineItemsBlock): LineItemsBlock {
  return {
    ...block,
    columns: block.columns.map(({ key, label, align }) => ({
      key,
      label,
      ...(align === undefined ? {} : { align }),
    })),
  };
}

const firstLineItems = (model: DocumentModel): LineItemsBlock => {
  const block = model.blocks.find((b): b is LineItemsBlock => b.type === 'lineItems');
  if (block === undefined) {
    throw new Error('no line table in the document');
  }
  return block;
};

interface QuoteCase {
  readonly input: {
    readonly customerName: string;
    readonly quote: QuoteWithLines;
    readonly totals: QuoteTotals;
    readonly papers: Readonly<Record<string, LinePaper>>;
  };
}

const { cases } = JSON.parse(
  readFileSync(resolve(__dirname, 'fixtures', 'quote-copy-parity.json'), 'utf8'),
) as { cases: QuoteCase[] };

function quoteTable(input: QuoteCase['input']): LineItemsBlock {
  return firstLineItems(
    buildQuoteDocument({
      brand: DEMO_BRAND,
      quote: input.quote,
      totals: input.totals,
      customerName: input.customerName,
      papers: new Map(Object.entries(input.papers)),
    }),
  );
}

function perRollCase(): QuoteCase['input'] {
  const input = cases[0]?.input;
  const named = input?.quote.lines[0];
  if (input === undefined || named === undefined) {
    throw new Error('the parity fixture has no per-roll case');
  }

  return {
    ...input,
    quote: {
      ...input.quote,
      lines: [
        ...input.quote.lines,
        {
          ...named,
          lineNumber: input.quote.lines.length + 1,
          rollWidthIn: 11,
          overwrap: false,
          customerPartNumber: 'LN-2846-C',
          quantityRolls: 120,
          pricePerRoll: '1385.40',
          extendedPrice: '166248.00',
          freightResult: { ...named.freightResult, mode: 'our_vehicle' },
        },
      ],
    },
  };
}

function perPoundCase(): QuoteCase['input'] {
  const input = cases[1]?.input;
  const perPound = input?.quote.lines[0];
  if (input === undefined || perPound === undefined) {
    throw new Error('the parity fixture has no per-pound case');
  }
  return {
    ...input,
    quote: {
      ...input.quote,
      lines: [
        { ...perPound, customerDescription: 'CEDAR CORE SHEET', customerPartNumber: 'LN-2846-C' },
        ...input.quote.lines.slice(1),
      ],
    },
  };
}

describe('the quote, on paper', () => {
  it("prints a line with the customer's names in three rows", async () => {
    const table = quoteTable(perRollCase());
    const named = table.rows.flatMap((row, index) =>
      row.description?.includes('CEDAR CORE SHEET') === true ? [index] : [],
    );

    expect(named).toHaveLength(2);
    for (const index of named) {
      expect(table.rows[index]?.description).toContain(' · Part LN-');
      expect(await rowsOf(table, index)).toBeLessThanOrEqual(3);
    }
    expect(await rowsOf(equalColumns(table), named[0] ?? 0)).toBeGreaterThan(3);
  });

  it("prints a per-pound line with the customer's names in three rows", async () => {
    const table = quoteTable(perPoundCase());
    expect(table.rows[0]?.description).toMatch(/CEDAR CORE SHEET .* · Part LN-2846-C · 20 rolls$/);
    expect(await rowsOf(table, 0)).toBeLessThanOrEqual(3);
  });

  it('prints every line of both fixtures in at most three rows, and the headers on one', async () => {
    for (const table of [quoteTable(perRollCase()), quoteTable(perPoundCase())]) {
      expect(await rowsDrawn({ ...table, rows: [] })).toBe(1);
      for (const index of table.rows.keys()) {
        expect(await rowsOf(table, index)).toBeLessThanOrEqual(3);
      }
    }
  });
});

describe('a column with a gutter', () => {
  it('keeps its text 12pt further from the next column', async () => {
    const table = (gutter: boolean): DocumentModel => ({
      title: 'Gutter',
      blocks: [
        {
          type: 'lineItems',
          columns: [
            { key: 'quantity', label: '', align: 'right', ...(gutter ? { gutter } : {}) },
            { key: 'description', label: '' },
          ],
          rows: [{ quantity: '36.500', description: 'LN-2846-C' }],
        },
      ],
    });
    const gap = async (gutter: boolean) => {
      const starts = textRuns(await renderer.render(table(gutter))).map(({ x }) => x);
      expect(starts).toHaveLength(2);
      const [figure = 0, description = 0] = starts.sort((a, b) => a - b);
      return description - figure;
    };

    expect((await gap(true)) - (await gap(false))).toBeCloseTo(12, 1);
  });
});

function confirmationTable(line: object): LineItemsBlock {
  const order = {
    id: 'O-3906',
    customerId: 'cust-1',
    status: 'confirmed',
    jobNumber: 'DPW-04718',
    confirmedLeadTimeDays: 10,
    confirmedBy: 'dev-production',
    confirmedAt: '2026-08-17T15:30:00.000Z',
    poNumber: 'PO-63075',
    createdAt: '2026-08-17T09:00:00.000Z',
    updatedAt: '2026-08-17T15:30:00.000Z',
    lines: [
      {
        id: 'oline-1',
        orderId: 'O-3906',
        lineNumber: 1,
        quoteLineId: 'line-1',
        gradeId: 'grade-1',
        footageVariant: 'long',
        feetPerRoll: '1250.0000',
        rollWidthIn: 24,
        quantityRolls: 10,
        overwrap: false,
        pallets: 2,
        estimatedWeightLb: '500',
        pricePerRoll: '100.00',
        totalCostPerRoll: '69.00',
        extendedPrice: '1000.00',
        extendedCost: '690.00',
        extendedMargin: '310.00',
        freight: { mode: 'pickup' },
        freightResult: {
          mode: 'pickup',
          cost: '0.00',
          margin: '0.00',
          invoiceTotal: '0.00',
          pending: false,
        },
        createdAt: '2026-08-17T09:00:00.000Z',
        updatedAt: '2026-08-17T09:00:00.000Z',
        ...line,
      },
    ],
  } as unknown as OrderWithLines;
  const totals = {
    extendedPrice: '1000.00',
    extendedCost: '690.00',
    extendedMargin: '310.00',
    estimatedWeightLb: '500',
    freightCost: '0.00',
    freightMargin: '0.00',
    freightInvoiceTotal: '0.00',
    freightPending: false,
  } as unknown as OrderTotals;
  return firstLineItems(
    buildOrderConfirmationDocument({
      brand: DEMO_BRAND,
      order,
      totals,
      customerName: 'Acme Papers',
      papers: new Map([
        ['grade-1', { productFamily: 'kraft', code: '53#', basisWeightLb: '53.0000' }],
      ]),
    }),
  );
}

async function descriptionRuns(block: LineItemsBlock, index: number): Promise<TextRun[]> {
  const row = block.rows[index];
  const label = block.columns.find((column) => column.key === 'description')?.label;
  if (row === undefined || label === undefined) {
    throw new Error(`no line ${String(index)} or no Description column in the table`);
  }
  const runs = textRuns(
    await renderer.render({ title: 'Rows', blocks: [{ ...block, rows: [row] }] }),
  );

  const head = runs.find((run) => run.text === label);
  if (head === undefined) {
    throw new Error(`the table drew no ${label} label`);
  }
  return runs.filter((run) => run.x === head.x && run.y < head.y).sort((a, b) => b.y - a.y);
}

async function descriptionRightEdge(block: LineItemsBlock): Promise<number> {
  const next = block.columns[block.columns.findIndex((column) => column.key === 'description') + 1];
  if (next === undefined) {
    throw new Error('no column after Description');
  }
  const columns = block.columns.map((column) =>
    column === next ? { ...column, align: 'left' as const } : column,
  );
  const runs = textRuns(
    await renderer.render({ title: 'Edge', blocks: [{ ...block, columns, rows: [] }] }),
  );
  const label = runs.find((run) => run.text === next.label);
  if (label === undefined) {
    throw new Error(`the table drew no ${next.label} label`);
  }
  return label.x;
}

const CAPITAL_WIDTHS = [
  667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667,
  611, 722, 667, 944, 667, 667, 611,
];
const SPACE_WIDTH = 278;
const HYPHEN_WIDTH = 333;

function widthOf(text: string): number {
  let units = 0;
  for (const character of text) {
    const width =
      character === '-'
        ? HYPHEN_WIDTH
        : character === ' '
          ? SPACE_WIDTH
          : CAPITAL_WIDTHS[character.charCodeAt(0) - 'A'.charCodeAt(0)];
    if (width === undefined) {
      throw new Error(`no width for ${JSON.stringify(character)}`);
    }
    units += width;
  }
  return (units * 10) / 1000;
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

describe('a word at a row end', () => {
  async function expectWholeWords(table: LineItemsBlock, index: number): Promise<void> {
    const description = table.rows[index]?.description;
    const rows = (await descriptionRuns(table, index)).map((run) => run.text);

    expect(rows.length).toBeGreaterThanOrEqual(2);

    expect(rows.join('')).toBe(description);

    for (const row of rows.slice(0, -1)) {
      expect(row).toMatch(/ $/);
    }

    const sheet = rows.findIndex((row) => row.startsWith('SHEET'));
    expect(sheet).toBeGreaterThan(0);
    expect(rows[sheet - 1]).toMatch(/ CORE $/);
  }

  it('moves a word to the next row whole on the quote', async () => {
    const table = quoteTable(perRollCase());
    const index = table.rows.findIndex(
      (row) => row.description?.includes('Part LN-2846-C') === true,
    );
    expect(table.rows[index]?.description).toContain('CEDAR CORE SHEET');

    await expectWholeWords(table, index);
  });

  it('moves a word to the next row whole on the order confirmation', async () => {
    const table = confirmationTable({
      customerDescription: 'CEDAR CORE SHEET',
      customerPartNumber: 'LN-2846-C',
    });
    expect(table.rows[0]?.description).toBe(
      'DP/24x1250/K53 · CEDAR CORE SHEET · Kraft — 53# · 24" × 1,250 ft · Part LN-2846-C',
    );

    await expectWholeWords(table, 0);
  });

  it(`moves a ${String(LONGEST_UNBROKEN_WORD)}-character token whole on the quote`, async () => {
    const token = ALPHABET.slice(0, LONGEST_UNBROKEN_WORD);
    expect(token).toHaveLength(25);
    const quote = quoteTable(perRollCase());
    const table = {
      ...quote,
      rows: [{ ...quote.rows[0], description: `DP/11x1250/K36 · ${token}` }],
    };

    const runs = await descriptionRuns(table, 0);
    expect(runs.map((run) => run.text)).toEqual(['DP/11x1250/K36 · ', token]);
    const edge = await descriptionRightEdge(table);
    const [, whole] = runs;
    expect((whole?.x ?? 0) + widthOf(token)).toBeLessThanOrEqual(edge);
  });

  it(`breaks a ${String(LONGEST_UNBROKEN_WORD + 1)}-character token inside the quote's Description`, async () => {
    const token = ALPHABET.slice(0, LONGEST_UNBROKEN_WORD + 1);
    expect(token).toHaveLength(26);
    const quote = quoteTable(perRollCase());
    const table = { ...quote, rows: [{ ...quote.rows[0], description: token }] };

    const runs = await descriptionRuns(table, 0);

    expect(runs.length).toBeGreaterThanOrEqual(2);
    expect(runs[0]?.text).toMatch(/^A[A-Z]+-$/);
    expect(runs.map((run) => run.text.replace(/-$/, '')).join('')).toBe(token);

    const edge = await descriptionRightEdge(table);
    for (const run of runs) {
      expect(run.x + widthOf(run.text)).toBeLessThanOrEqual(edge);
    }
  });
});
