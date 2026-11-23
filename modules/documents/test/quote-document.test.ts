// The quote's content: roll descriptions, freight and its pending marker, lead time, dates,
// per-pound lines, freight in the roll price, and the quote number.
import type { LinePaper, QuoteLine, QuoteTotals, QuoteWithLines } from '@erp/types';
import { describe, expect, it } from 'vitest';
import type {
  KeyValuesBlock,
  LineItemsBlock,
  NoticeBlock,
  TotalsBlock,
} from '../src/document-model';
import {
  FREIGHT_TBD,
  buildQuoteDocument as withBrand,
  type QuoteDocumentInput,
} from '../src/templates/quote-document';
import { DEMO_BRAND, brandedFooter, letterheadBlock } from '../src/brands';
import { FREIGHT_INCLUDED_NOTICE } from '../src/templates/document-formatting';

const PAPERS: ReadonlyMap<string, LinePaper> = new Map([
  ['grade-1', { productFamily: 'kraft', code: '59#', basisWeightLb: '59.0000' }],
]);

const buildQuoteDocument = (
  input: Omit<QuoteDocumentInput, 'brand' | 'papers'> & { papers?: QuoteDocumentInput['papers'] },
) => withBrand({ brand: DEMO_BRAND, papers: PAPERS, ...input });

const line = (overrides: Partial<QuoteLine> = {}): QuoteLine =>
  ({
    id: 'line-1',
    quoteId: 'Q-0517',
    lineNumber: 1,
    gradeId: 'grade-1',
    footageVariant: '1175ft',
    rollWidthIn: 24,
    quantityRolls: 10,
    overwrap: false,
    freight: { mode: 'pickup' },
    cost: {},
    tier: {},
    pallets: 2,
    basePricePerRoll: '100.00',
    pricePerRoll: '100.00',
    priceSource: 'tier',
    deliveredPricePerRoll: '100.00',
    marginPct: '0.31',
    floor: { status: 'above' },
    extendedPrice: '1000.00',
    extendedCost: '690.00',
    extendedMargin: '310.00',
    freightResult: {
      mode: 'pickup',
      cost: '0.00',
      margin: '0.00',
      invoiceTotal: '0.00',
      pending: false,
    },
    estimatedWeightLb: '540',
    pricePerLb: '1.85',
    effectivePricePerLb: '1.85',
    createdAt: '2026-08-10T00:00:00.000Z',
    updatedAt: '2026-08-10T00:00:00.000Z',
    ...overrides,
  }) as QuoteLine;

const quote = (lines: QuoteLine[], overrides: Partial<QuoteWithLines> = {}): QuoteWithLines =>
  ({
    id: 'Q-0517',
    customerId: 'cust-1',
    status: 'quoted',
    rootQuoteId: 'Q-0517',
    versionNumber: 1,
    quoteNumber: 1,
    createdAt: '2026-08-10T00:00:00.000Z',
    updatedAt: '2026-08-10T00:00:00.000Z',
    lines,
    ...overrides,
  }) as QuoteWithLines;

const totals: QuoteTotals = {
  extendedPrice: '1000.00',
  extendedCost: '690.00',
  extendedMargin: '310.00',
  estimatedWeightLb: '540',
};

const lineItems = (model: ReturnType<typeof buildQuoteDocument>): LineItemsBlock =>
  model.blocks.find((block): block is LineItemsBlock => block.type === 'lineItems')!;

const notice = (model: ReturnType<typeof buildQuoteDocument>): NoticeBlock | undefined =>
  model.blocks.find((block): block is NoticeBlock => block.type === 'notice');

const totalsBlock = (model: ReturnType<typeof buildQuoteDocument>): TotalsBlock =>
  model.blocks.find((block): block is TotalsBlock => block.type === 'totals')!;

describe('buildQuoteDocument', () => {
  it('states the feet the line was priced on, not the variant code', () => {
    const model = buildQuoteDocument({
      quote: quote([
        line({
          footageVariant: 'long',
          cost: { feetPerRoll: '1250.0000' },
        } as Partial<QuoteLine>),
      ]),
      totals,
      customerName: 'Acme Papers',
    });

    expect(lineItems(model).rows[0]?.description).toBe(
      'DP/24x1250/K59 · Kraft — 59# · 24" × 1,250 ft',
    );
  });

  it('prints no variant code on any roll, and keeps the overwrap', () => {
    const model = buildQuoteDocument({
      quote: quote([
        line({ footageVariant: 'long', cost: { feetPerRoll: '1250.0000' } } as Partial<QuoteLine>),
        line({
          id: 'line-2',
          lineNumber: 2,
          footageVariant: 'short',
          overwrap: true,
          cost: { feetPerRoll: '960.0000' },
        } as Partial<QuoteLine>),
        line({
          id: 'line-3',
          lineNumber: 3,
          footageVariant: '500',
          cost: { feetPerRoll: '1480.0000' },
        } as Partial<QuoteLine>),
      ]),
      totals,
      customerName: 'Acme Papers',
    });

    expect(lineItems(model).rows.map((row) => row.description)).toEqual([
      'DP/24x1250/K59 · Kraft — 59# · 24" × 1,250 ft',
      'DP/24x960/K59 · Kraft — 59# · 24" × 960 ft · overwrapped',
      'DP/24x1480/K59 · Kraft — 59# · 24" × 1,480 ft',
    ]);
    expect(JSON.stringify(model)).not.toMatch(/\((long|short|500)\)/);
  });

  it('names the paper before the roll, as the Paper picker spells it', () => {
    const model = buildQuoteDocument({
      quote: quote([
        line({ footageVariant: 'long', cost: { feetPerRoll: '1250.0000' } } as Partial<QuoteLine>),
        line({
          id: 'line-2',
          lineNumber: 2,
          gradeId: 'grade-2',
          footageVariant: 'long',
          cost: { feetPerRoll: '1215.0000' },
        } as Partial<QuoteLine>),
      ]),
      totals,
      customerName: 'Acme Papers',
      papers: new Map([
        ['grade-1', { productFamily: 'kraft', code: '59#', basisWeightLb: '59.0000' }],
        ['grade-2', { productFamily: 'butcher', code: '48#', basisWeightLb: '48.0000' }],
      ]),
    });

    expect(lineItems(model).rows.map((row) => row.description)).toEqual([
      'DP/24x1250/K59 · Kraft — 59# · 24" × 1,250 ft',
      'Butcher — 48# · 24" × 1,215 ft',
    ]);
  });

  it('leads with the roll code, from the poundage, the width and the effective feet', () => {
    const model = buildQuoteDocument({
      quote: quote([
        line({
          rollWidthIn: 17,
          customWidth: true,
          footageVariant: 'long',
          cost: { feetPerRoll: '640.0000' },
        } as Partial<QuoteLine>),
        line({
          id: 'line-2',
          lineNumber: 2,
          gradeId: 'grade-2',
          footageVariant: 'long',
          cost: { feetPerRoll: '1395.0000' },
        } as Partial<QuoteLine>),
      ]),
      totals,
      customerName: 'Acme Papers',
      papers: new Map([
        ['grade-1', { productFamily: 'kraft', code: '59#', basisWeightLb: '59.0000' }],

        ['grade-2', { productFamily: 'newsprint', code: '35#', basisWeightLb: '32.6000' }],
      ]),
    });

    expect(lineItems(model).rows.map((row) => row.description)).toEqual([
      'DP/17x640/K59 · Kraft — 59# · 17" custom × 640 ft',
      'DP/24x1395/N35 · Newsprint — 35# · 24" × 1,395 ft',
    ]);
  });

  it('prints a stock width in sixteenths as its fraction', () => {
    const model = buildQuoteDocument({
      quote: quote([
        line({
          gradeId: 'grade-db',
          rollWidthIn: 11.3125,
          footageVariant: '500',
          cost: { feetPerRoll: '1480.0000' },
        } as Partial<QuoteLine>),
      ]),
      totals,
      customerName: 'Acme Papers',
      papers: new Map([
        ['grade-db', { productFamily: 'digital_bond', code: '28#', basisWeightLb: '28.0000' }],
      ]),
    });

    expect(lineItems(model).rows[0]?.description).toBe('Digital Bond — 28# · 11 5/16" × 1,480 ft');
  });

  it('prints the roll alone, never an id, for a line whose grade it was not given', () => {
    const model = buildQuoteDocument({
      quote: quote([
        line({ footageVariant: 'long', cost: { feetPerRoll: '1250.0000' } } as Partial<QuoteLine>),
      ]),
      totals,
      customerName: 'Acme Papers',
      papers: new Map(),
    });

    expect(lineItems(model).rows[0]?.description).toBe('24" × 1,250 ft');
    expect(JSON.stringify(model)).not.toContain('grade-1');
  });

  it('prints the freight figure when the bid is known', () => {
    const model = buildQuoteDocument({
      quote: quote([
        line({
          freightResult: {
            mode: 'carrier',
            cost: '113.68',
            margin: '28.42',
            invoiceTotal: '142.10',
            pending: false,
          },
        }),
      ]),
      totals,
      customerName: 'Acme Papers',
    });

    expect(lineItems(model).rows[0]?.freight).toBe('$142.10');
    expect(notice(model)).toBeUndefined();
  });

  it('never prints $0.00 for a pending carrier bid', () => {
    const model = buildQuoteDocument({
      quote: quote([
        line({
          freightResult: {
            mode: 'carrier',
            cost: '0.00',
            margin: '0.00',
            invoiceTotal: '0.00',
            pending: true,
          },
        }),
      ]),
      totals,
      customerName: 'Acme Papers',
    });

    expect(lineItems(model).rows[0]?.freight).toBe(FREIGHT_TBD);
    expect(lineItems(model).rows[0]?.freight).not.toContain('0.00');
  });

  it('distinguishes a pending bid from genuinely free pickup freight', () => {
    const pickup = buildQuoteDocument({
      quote: quote([line()]),
      totals,
      customerName: 'Acme Papers',
    });
    const pendingBid = buildQuoteDocument({
      quote: quote([
        line({
          freightResult: {
            mode: 'carrier',
            cost: '0.00',
            margin: '0.00',
            invoiceTotal: '0.00',
            pending: true,
          },
        }),
      ]),
      totals,
      customerName: 'Acme Papers',
    });

    expect(lineItems(pickup).rows[0]?.freight).toBe('$0.00');
    expect(lineItems(pendingBid).rows[0]?.freight).toBe(FREIGHT_TBD);
  });

  it('warns and qualifies the total when any line is pending', () => {
    const model = buildQuoteDocument({
      quote: quote([
        line(),
        line({
          id: 'line-2',
          lineNumber: 2,
          freightResult: {
            mode: 'carrier',
            cost: '0.00',
            margin: '0.00',
            invoiceTotal: '0.00',
            pending: true,
          },
        }),
      ]),
      totals,
      customerName: 'Acme Papers',
    });

    expect(notice(model)?.tone).toBe('warning');
    expect(totalsBlock(model).rows[0]?.label).toContain('freight not final');
  });

  it('prints the known leg plus an outstanding marker for a partial pass_through line', () => {
    const model = buildQuoteDocument({
      quote: quote([
        line({
          freightResult: {
            mode: 'pass_through',
            cost: '37.00',
            margin: '0.00',
            invoiceTotal: '37.00',
            pending: true,
          },
        }),
      ]),
      totals,
      customerName: 'Acme Papers',
    });

    expect(lineItems(model).rows[0]?.freight).toBe(`$37.00 + ${FREIGHT_TBD}`);
  });

  it('never prints a partial pass_through figure as though it were final', () => {
    const freightResult = {
      mode: 'pass_through' as const,
      cost: '37.00',
      margin: '0.00',
      invoiceTotal: '37.00',
    };
    const outstanding = buildQuoteDocument({
      quote: quote([line({ freightResult: { ...freightResult, pending: true } })]),
      totals,
      customerName: 'Acme Papers',
    });
    const settled = buildQuoteDocument({
      quote: quote([line({ freightResult: { ...freightResult, pending: false } })]),
      totals,
      customerName: 'Acme Papers',
    });

    expect(lineItems(settled).rows[0]?.freight).toBe('$37.00');
    expect(lineItems(outstanding).rows[0]?.freight).not.toBe('$37.00');
    expect(lineItems(outstanding).rows[0]?.freight).toContain('$37.00');
  });

  it('does not claim the total excludes freight when a known leg is inside it', () => {
    const model = buildQuoteDocument({
      quote: quote([
        line({
          freightResult: {
            mode: 'pass_through',
            cost: '37.00',
            margin: '0.00',
            invoiceTotal: '37.00',
            pending: true,
          },
        }),
      ]),
      totals,
      customerName: 'Acme Papers',
    });

    expect(notice(model)?.tone).toBe('warning');
    expect(notice(model)?.text).not.toContain('excludes');
    expect(totalsBlock(model).rows[0]?.label).not.toContain('excludes');
  });

  it('keeps a partial pass_through line distinguishable from a pending carrier line', () => {
    const partial = buildQuoteDocument({
      quote: quote([
        line({
          freightResult: {
            mode: 'pass_through',
            cost: '37.00',
            margin: '0.00',
            invoiceTotal: '37.00',
            pending: true,
          },
        }),
      ]),
      totals,
      customerName: 'Acme Papers',
    });
    const unknown = buildQuoteDocument({
      quote: quote([
        line({
          freightResult: {
            mode: 'carrier',
            cost: '0.00',
            margin: '0.00',
            invoiceTotal: '0.00',
            pending: true,
          },
        }),
      ]),
      totals,
      customerName: 'Acme Papers',
    });

    expect(lineItems(unknown).rows[0]?.freight).toBe(FREIGHT_TBD);
    expect(lineItems(partial).rows[0]?.freight).not.toBe(FREIGHT_TBD);
  });

  it('formats money with thousands separators from the decimal string', () => {
    const model = buildQuoteDocument({
      quote: quote([line({ extendedPrice: '3804219.5' })]),
      totals: { ...totals, extendedPrice: '3804219.5' },
      customerName: 'Acme Papers',
    });

    expect(lineItems(model).rows[0]?.extended).toBe('$3,804,219.50');
    expect(totalsBlock(model).rows[0]?.value).toBe('$3,804,219.50');
  });

  it('prints no customer-facing shipping-mode wording', () => {
    const model = buildQuoteDocument({
      quote: quote([line({ freight: { mode: 'pass_through' } as QuoteLine['freight'] })]),
      totals,
      customerName: 'Acme Papers',
    });

    const rendered = JSON.stringify(model).toLowerCase();
    for (const word of ['pass-through', 'pass_through', 'our vehicle', 'from facility']) {
      expect(rendered).not.toContain(word);
    }
  });
});

describe('lead time', () => {
  const keyRows = (model: ReturnType<typeof buildQuoteDocument>) =>
    model.blocks.find((block): block is KeyValuesBlock => block.type === 'keyValues')!.rows;

  it('prints the days the Production Manager entered', () => {
    const model = buildQuoteDocument({
      quote: quote([line()], { leadTimeDays: 14 }),
      customerName: 'Acme',
      totals,
    });

    expect(keyRows(model)).toContainEqual({ label: 'Lead time', value: '14 days' });
  });

  it('says "Same day" rather than "0 days"', () => {
    const model = buildQuoteDocument({
      quote: quote([line()], { leadTimeDays: 0 }),
      customerName: 'Acme',
      totals,
    });

    expect(keyRows(model)).toContainEqual({ label: 'Lead time', value: 'Same day' });
  });

  it('says "1 day", not "1 days"', () => {
    const model = buildQuoteDocument({
      quote: quote([line()], { leadTimeDays: 1 }),
      customerName: 'Acme',
      totals,
    });

    expect(keyRows(model)).toContainEqual({ label: 'Lead time', value: '1 day' });
  });

  it('omits the row entirely when there is none', () => {
    const model = buildQuoteDocument({
      quote: quote([line()]),
      customerName: 'Acme',
      totals,
    });

    expect(keyRows(model).some((row) => row.label === 'Lead time')).toBe(false);
  });
});

describe('buildQuoteDocument - the date the customer reads', () => {
  const dateRow = (model: ReturnType<typeof buildQuoteDocument>) =>
    model.blocks
      .find((block): block is KeyValuesBlock => block.type === 'keyValues')!
      .rows.find((row) => row.label === 'Date')?.value;

  it('dates a quote by the Pacific day, not the UTC day', () => {
    const model = buildQuoteDocument({ quote: quote([line()]), totals, customerName: 'Acme' });

    expect(dateRow(model)).toBe('2026-08-09');
  });

  it('prefers quotedAt over createdAt, and reads that in Pacific too', () => {
    const model = buildQuoteDocument({
      quote: quote([line()]),
      totals,
      customerName: 'Acme',

      quotedAt: '2026-08-19T00:30:00.000Z',
    });

    expect(dateRow(model)).toBe('2026-08-18');
  });

  it('is right in winter as well as summer - the offset is not hard-coded', () => {
    const model = buildQuoteDocument({
      quote: quote([line()]),
      totals,
      customerName: 'Acme',
      quotedAt: '2026-01-15T00:30:00.000Z',
    });

    expect(dateRow(model)).toBe('2026-01-14');
  });
});

describe('buildQuoteDocument - a line priced per pound', () => {
  const perPound = (overrides: Partial<QuoteLine> = {}): QuoteLine =>
    line({
      id: 'line-2',
      lineNumber: 2,
      quantityRolls: 20,
      pricingBasis: 'per_pound',
      productPricePerLb: '0.6418',
      orderedWeightLb: '1000.0000',
      pricePerRoll: '29.7619',
      extendedPrice: '641.8000',
      estimatedWeightLb: '927.4500',
      ...overrides,
    });
  const perRoll = line({ pricingBasis: 'per_roll' });
  const build = (lines: QuoteLine[]) =>
    buildQuoteDocument({ quote: quote(lines), totals, customerName: 'Acme' });

  it('prints per-roll lines with rolls and price per roll', () => {
    const model = build([perRoll]);
    expect(lineItems(model).columns.map((c) => c.label)).toEqual([
      '#',
      'Description',
      'Rolls',
      'Price / roll',
      'Delivery',
      'Freight',
      'Extended',
    ]);
    expect(lineItems(model).rows[0]).toMatchObject({
      quantity: '10',
      unitPrice: '$100.00',
      extended: '$1,000.00',
    });
    expect(lineItems(model).rows[0]?.description).not.toContain('rolls');
    expect(notice(model)).toBeUndefined();
    expect(totalsBlock(model).rows[0]?.label).toBe('Total');
  });

  it('prints the pounds ordered, the price per pound and an estimated total', () => {
    const row = lineItems(build([perPound()])).rows[0];

    expect(row?.quantity).toBe('1,000 lb');

    expect(row?.unitPrice).toBe('$0.6418 / lb');

    expect(row?.extended).toBe('$641.80 est.');
  });

  it('does not print the geometry estimate as the quantity', () => {
    const row = lineItems(build([perPound()])).rows[0];
    expect(row?.quantity).not.toContain('927.45');
    expect(row?.description).not.toContain('927.45');
  });

  it('falls back to the labelled estimate for a line built with no pounds ordered', () => {
    const row = lineItems(build([perPound({ orderedWeightLb: undefined })])).rows[0];
    expect(row?.quantity).toBe('927.45 lb est.');
  });

  it('orders the columns quantity in pounds, unit price, line total', () => {
    const keys = lineItems(build([perPound()])).columns.map((c) => c.key);
    expect(keys.indexOf('quantity')).toBeLessThan(keys.indexOf('unitPrice'));
    expect(keys.indexOf('unitPrice')).toBeLessThan(keys.indexOf('extended'));
  });

  it('says how many rolls, because the line is made in rolls', () => {
    expect(lineItems(build([perPound()])).rows[0]?.description).toMatch(/ · 20 rolls$/);
    expect(lineItems(build([perPound({ quantityRolls: 1 })])).rows[0]?.description).toMatch(
      / · 1 roll$/,
    );
  });

  it('goes unit-neutral when lines are mixed, and every cell names its unit', () => {
    const model = build([perRoll, perPound()]);
    const labels = lineItems(model).columns.map((c) => c.label);
    expect(labels).toContain('Qty');
    expect(labels).toContain('Unit price');
    expect(labels).not.toContain('Rolls');
    expect(labels).not.toContain('Price / roll');
    expect(lineItems(model).rows[0]).toMatchObject({
      quantity: '10 rolls',
      unitPrice: '$100.00 / roll',
      extended: '$1,000.00',
    });
    expect(lineItems(model).rows[1]?.quantity).toBe('1,000 lb');
  });

  it("carries the line's freight inside the estimated total, as every line's Extended does", () => {
    const row = lineItems(
      build([
        perPound({
          extendedPrice: '685.8000',
          freightResult: {
            mode: 'carrier',
            cost: '44.00',
            margin: '0.00',
            invoiceTotal: '44.00',
            pending: false,
          },
        }),
      ]),
    ).rows[0];
    expect(row?.freight).toBe('$44.00');
    expect(row?.extended).toBe('$685.80 est.');
  });

  it('says once which weight is billed, and labels the total an estimate', () => {
    const model = build([perPound()]);
    const said = notice(model);
    expect(said?.tone).toBe('info');
    expect(said?.text).toBe(
      'Lines priced by the pound show the pounds ordered. ' +
        'They are invoiced at the weight measured when the order ships.',
    );

    expect(said?.text).not.toMatch(/gross|pallet|net/i);
    expect(totalsBlock(model).rows[0]?.label).toBe('Total (estimated)');
  });

  it('names both qualifications when freight is also pending', () => {
    const model = build([
      perPound({
        freightResult: {
          mode: 'carrier',
          cost: '0.00',
          margin: '0.00',
          invoiceTotal: '0.00',
          pending: true,
        },
      }),
    ]);
    const notices = model.blocks.filter((b): b is NoticeBlock => b.type === 'notice');
    expect(notices.map((n) => n.tone)).toEqual(['info', 'warning']);
    expect(totalsBlock(model).rows[0]?.label).toBe('Total (estimated, freight not final)');
  });
});

describe('buildQuoteDocument - freight in the price per roll', () => {
  const harbor = (overrides: Partial<QuoteLine> = {}): QuoteLine =>
    line({
      pricingBasis: 'per_roll',
      freight: { mode: 'our_vehicle' },
      freightResult: {
        mode: 'our_vehicle',
        cost: '41.0000',
        margin: '0.0000',
        invoiceTotal: '41.0000',
        pending: false,
      },
      pricePerRoll: '100.0000',
      deliveredPricePerRoll: '104.1000',
      extendedPrice: '1041.0000',
      ...overrides,
    });
  const withFreight: QuoteTotals = { ...totals, extendedPrice: '1041.0000' };
  const build = (lines: QuoteLine[], freightInRollPrice: boolean) =>
    buildQuoteDocument({
      quote: quote(lines, { freightInRollPrice }),
      totals: withFreight,
      customerName: 'Acme',
    });
  const notices = (model: ReturnType<typeof buildQuoteDocument>) =>
    model.blocks.filter((b): b is NoticeBlock => b.type === 'notice');

  it('prints freight in its own column with the flag off', () => {
    const model = build([harbor()], false);
    expect(lineItems(model).columns.map((c) => c.label)).toEqual([
      '#',
      'Description',
      'Rolls',
      'Price / roll',
      'Delivery',
      'Freight',
      'Extended',
    ]);
    expect(lineItems(model).rows[0]).toMatchObject({
      unitPrice: '$100.00',
      freight: '$41.00',
      extended: '$1,041.00',
    });
    expect(notices(model)).toEqual([]);
  });

  it('prints the price per roll with its freight, drops the Freight column, and says so', () => {
    const model = build([harbor()], true);
    expect(lineItems(model).columns.map((c) => c.label)).toEqual([
      '#',
      'Description',
      'Rolls',
      'Price / roll incl. freight',
      'Delivery',
      'Extended',
    ]);
    const row = lineItems(model).rows[0];
    expect(row).toMatchObject({ quantity: '10', unitPrice: '$104.10', extended: '$1,041.00' });
    expect(row).not.toHaveProperty('freight');
    expect(notices(model)).toEqual([
      { type: 'notice', tone: 'info', text: FREIGHT_INCLUDED_NOTICE },
    ]);
    expect(FREIGHT_INCLUDED_NOTICE).toBe("Freight is included in each line's price.");
  });

  it('keeps the total, because the freight moved into the lines, not out of them', () => {
    const off = build([harbor()], false);
    const on = build([harbor()], true);
    expect(totalsBlock(on)).toEqual(totalsBlock(off));
    expect(totalsBlock(on).rows[0]).toMatchObject({ label: 'Total', value: '$1,041.00' });
  });

  it('prints an Extended that is the price per roll with freight times the rolls', () => {
    const row = lineItems(build([harbor()], true)).rows[0];
    expect(row?.unitPrice).toBe('$104.10');
    expect(row?.extended).toBe('$1,041.00');
  });

  it('prints a pickup line at its own price, its freight being nothing', () => {
    const row = lineItems(build([line({ pricingBasis: 'per_roll' })], true)).rows[0];
    expect(row?.unitPrice).toBe('$100.00');
  });

  it('prints what is known and TBD for a line waiting on its carrier bid', () => {
    const model = build(
      [
        harbor({
          freight: { mode: 'carrier' },
          freightResult: {
            mode: 'carrier',
            cost: '0.0000',
            margin: '0.0000',
            invoiceTotal: '0.0000',
            pending: true,
          },
          extendedPrice: '1000.0000',
        }),
      ],
      true,
    );
    expect(lineItems(model).rows[0]?.unitPrice).toBe(`$100.00 + ${FREIGHT_TBD}`);

    expect(notices(model).map((n) => n.tone)).toEqual(['info', 'warning']);
    expect(totalsBlock(model).rows[0]?.label).toBe('Total (freight not final)');
  });

  it('prints the known warehouse leg inside the price, plus TBD, for a pass-thru line', () => {
    const row = lineItems(
      build(
        [
          harbor({
            freight: { mode: 'pass_through' },
            freightResult: {
              mode: 'pass_through',
              cost: '41.0000',
              margin: '0.0000',
              invoiceTotal: '41.0000',
              pending: true,
            },
          }),
        ],
        true,
      ),
    ).rows[0];
    expect(row?.unitPrice).toBe(`$104.10 + ${FREIGHT_TBD}`);
  });

  it('ignores the flag and prints freight apart while any line is priced per pound', () => {
    const perPound = line({
      id: 'line-2',
      lineNumber: 2,
      quantityRolls: 20,
      pricingBasis: 'per_pound',
      productPricePerLb: '0.6418',
      orderedWeightLb: '1000.0000',
      pricePerRoll: '29.7619',
      extendedPrice: '641.8000',
      estimatedWeightLb: '927.4500',
    });
    const on = build([harbor(), perPound], true);
    const off = build([harbor(), perPound], false);
    expect(on).toEqual(off);
    expect(lineItems(on).columns.map((c) => c.label)).toEqual([
      '#',
      'Description',
      'Qty',
      'Unit price',
      'Delivery',
      'Freight',
      'Extended',
    ]);
    expect(notices(on).map((n) => n.text)).not.toContain(FREIGHT_INCLUDED_NOTICE);
  });
});

describe("buildQuoteDocument - the customer's names for the goods", () => {
  it('leads with the customer description and closes with the part number', () => {
    const model = buildQuoteDocument({
      quote: quote([
        line({
          footageVariant: 'long',
          cost: { feetPerRoll: '1250.0000' },
          overwrap: true,
          customerDescription: 'CEDAR CORE SHEET',
          customerPartNumber: 'LN-4417-C',
        } as Partial<QuoteLine>),
      ]),
      totals,
      customerName: 'Acme Papers',
    });

    expect(lineItems(model).rows[0]?.description).toBe(
      'DP/24x1250/K59 · CEDAR CORE SHEET · Kraft — 59# · 24" × 1,250 ft · overwrapped · Part LN-4417-C',
    );
  });

  it('names the paper on a per-pound line in the same place, before the roll count', () => {
    const model = buildQuoteDocument({
      quote: quote([
        line({
          footageVariant: 'long',
          cost: { feetPerRoll: '1250.0000' },
          pricingBasis: 'per_pound',
          productPricePerLb: '0.6418',
          orderedWeightLb: '1000.0000',
          quantityRolls: 20,
          customerDescription: 'CEDAR CORE SHEET',
          customerPartNumber: 'LN-4417-C',
        } as Partial<QuoteLine>),
      ]),
      totals,
      customerName: 'Acme Papers',
    });

    expect(lineItems(model).rows[0]?.description).toBe(
      'DP/24x1250/K59 · CEDAR CORE SHEET · Kraft — 59# · 24" × 1,250 ft · Part LN-4417-C · 20 rolls',
    );
  });
});

describe('buildQuoteDocument - the widths', () => {
  const WIDTHS = [
    { key: 'line', share: 0.25 },
    { key: 'description', share: 3.15 },
    { key: 'quantity', share: 0.75 },
    { key: 'unitPrice', share: 1, gutter: true },
    { key: 'delivery', share: 1.7 },
    { key: 'freight', share: 0.95 },
    { key: 'extended', share: 1 },
  ];
  const widths = (model: ReturnType<typeof buildQuoteDocument>) =>
    lineItems(model).columns.map(({ key, share, gutter }) => ({ key, share, gutter }));

  it('gives Description the width and the unit price a gutter before Delivery', () => {
    const perRoll = buildQuoteDocument({ quote: quote([line()]), totals, customerName: 'Acme' });
    expect(widths(perRoll)).toEqual(WIDTHS);
  });

  it('keeps the same widths under the unit-neutral headers', () => {
    const perPound = line({
      pricingBasis: 'per_pound',
      productPricePerLb: '0.6418',
      orderedWeightLb: '1000.0000',
    } as Partial<QuoteLine>);
    const model = buildQuoteDocument({ quote: quote([perPound]), totals, customerName: 'Acme' });
    expect(lineItems(model).columns.map((c) => c.label)).toContain('Unit price');
    expect(widths(model)).toEqual(WIDTHS);
  });
});

describe('buildQuoteDocument - the quote number', () => {
  const heading = (model: ReturnType<typeof buildQuoteDocument>) =>
    model.blocks.find((block) => block.type === 'heading');

  it('names a first version by its number alone, in the title, subtitle and footer', () => {
    const model = buildQuoteDocument({
      quote: quote([line()], { quoteNumber: 318, versionNumber: 1 }),
      totals,
      customerName: 'Acme Papers',
    });

    expect(model.title).toBe('Quote Q-00318');
    expect(heading(model)).toMatchObject({ title: 'Quote', subtitle: 'Q-00318' });
    expect(model.footer).toBe(brandedFooter(DEMO_BRAND, 'Quote Q-00318'));
  });

  it('adds the version from the first revision on', () => {
    const model = buildQuoteDocument({
      quote: quote([line()], { quoteNumber: 318, versionNumber: 2 }),
      totals,
      customerName: 'Acme Papers',
    });

    expect(model.title).toBe('Quote Q-00318 v2');
    expect(heading(model)).toMatchObject({ subtitle: 'Q-00318 v2' });
    expect(model.footer).toBe(brandedFooter(DEMO_BRAND, 'Quote Q-00318 v2'));
  });

  it('never prints the system id', () => {
    const model = buildQuoteDocument({
      quote: quote([line()], { id: '01a4d7b3-3333-7000-8000-00000000abcd', quoteNumber: 318 }),
      totals,
      customerName: 'Acme Papers',
    });

    expect(JSON.stringify(model)).not.toContain('01a4d7b3');
  });
});

describe('the letterhead', () => {
  it('opens with the letterhead and signs every page with the short line', () => {
    const model = buildQuoteDocument({
      quote: quote([line()], { quoteNumber: 318, versionNumber: 1 }),
      totals,
      customerName: 'Acme Papers',
    });

    expect(model.blocks[0]).toEqual(letterheadBlock(DEMO_BRAND));
    expect(model.blocks[0]).toEqual({
      type: 'letterhead',
      nameLines: ['DEMO', 'PRINTWORKS'],
      detailLines: ['100 EXAMPLE WAY', 'EXAMPLE CITY, ID 83000', 'TELEPHONE 208-555-0142'],
    });
    expect(model.blocks.filter((block) => block.type === 'letterhead')).toHaveLength(1);
    expect(model.footer).toBe('Quote Q-00318 · Demo Printworks · 208-555-0142');
  });
});
