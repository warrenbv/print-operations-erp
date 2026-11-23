// Holds the on-screen customer copy to the shared fixture the quote PDF is also tested against, so the two cannot drift.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { Grade, LinePaper, QuoteTotals, QuoteWithLines } from '@erp/types';

import { customerCopy, papersOf } from './customer-copy';

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

const ROOT = resolve(__dirname, '..', '..', '..', '..', '..', '..', '..', '..');
const FIXTURE = resolve(ROOT, 'modules', 'documents', 'test', 'fixtures', 'quote-copy-parity.json');
const { cases } = JSON.parse(readFileSync(FIXTURE, 'utf8')) as { cases: ParityCase[] };

describe('customerCopy, against the quote PDF', () => {
  it('reads the shared fixture', () => {
    expect(cases.length).toBeGreaterThanOrEqual(3);
  });

  it.each(cases.map((parity) => [parity.name, parity] as const))('%s', (_name, parity) => {
    expect(
      customerCopy({ ...parity.input, papers: new Map(Object.entries(parity.input.papers)) }),
    ).toEqual(parity.expected);
  });
});

describe('papersOf', () => {
  it("keys each grade's paper by its id, as the API hands the PDF its papers", () => {
    const grades = [
      { id: 'g-1', productFamily: 'kraft', code: '58#', basisWeightLb: '58.0000' },
      { id: 'g-2', productFamily: 'newsprint', code: '39#', basisWeightLb: '31.6000' },
    ] as unknown as Grade[];

    expect(papersOf(grades)).toEqual(
      new Map([
        ['g-1', { productFamily: 'kraft', code: '58#', basisWeightLb: '58.0000' }],
        ['g-2', { productFamily: 'newsprint', code: '39#', basisWeightLb: '31.6000' }],
      ]),
    );
  });
});
