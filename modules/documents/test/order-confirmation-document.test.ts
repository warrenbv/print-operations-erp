// The order confirmation's content: job number, PO, committed lead time in calendar days, the order's
// own figures and the freight wording. Rules: docs/product/requirements.md (R9) and (R11).
import type { LinePaper, OrderLine, OrderTotals, OrderWithLines } from '@erp/types';
import { describe, expect, it } from 'vitest';
import { DEMO_BRAND, brandedFooter, letterheadBlock } from '../src/brands';
import type {
  KeyValuesBlock,
  LineItemsBlock,
  NoticeBlock,
  TotalsBlock,
} from '../src/document-model';
import {
  buildOrderConfirmationDocument,
  leadTimeText,
} from '../src/templates/order-confirmation-document';
import { FREIGHT_TBD } from '../src/templates/document-formatting';

const line = (overrides: Partial<OrderLine> = {}): OrderLine =>
  ({
    id: 'oline-1',
    orderId: 'O-3906',
    lineNumber: 1,
    quoteLineId: 'line-1',
    gradeId: 'grade-1',
    footageVariant: '1175ft',
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
    ...overrides,
  }) as OrderLine;

const order = (overrides: Partial<OrderWithLines> = {}): OrderWithLines =>
  ({
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
    lines: [line()],
    ...overrides,
  }) as OrderWithLines;

const totals = (overrides: Partial<OrderTotals> = {}): OrderTotals =>
  ({
    extendedPrice: '1000.00',
    extendedCost: '690.00',
    extendedMargin: '310.00',
    estimatedWeightLb: '500',
    freightCost: '0.00',
    freightMargin: '0.00',
    freightInvoiceTotal: '0.00',
    freightPending: false,
    ...overrides,
  }) as OrderTotals;

const PAPERS: ReadonlyMap<string, LinePaper> = new Map([
  ['grade-1', { productFamily: 'kraft', code: '47#', basisWeightLb: '47.0000' }],
]);

const build = (o = order(), t = totals(), papers: ReadonlyMap<string, LinePaper> = PAPERS) =>
  buildOrderConfirmationDocument({
    brand: DEMO_BRAND,
    order: o,
    totals: t,
    customerName: 'Acme Papers',
    papers,
  });

const blockOfType = <T>(model: ReturnType<typeof build>, type: string): T =>
  model.blocks.find((b) => b.type === type) as T;

describe('buildOrderConfirmationDocument — what the customer is committed to', () => {
  it('leads with the job number, the number everyone quotes', () => {
    const model = build();

    expect(model.title).toBe('Order Confirmation DPW-04718');
    expect(model.footer).toBe(brandedFooter(DEMO_BRAND, 'Order Confirmation DPW-04718'));

    expect(model.blocks[1]).toMatchObject({
      type: 'heading',
      title: 'Order Confirmation',
      subtitle: 'DPW-04718',
    });
  });

  it("echoes the customer's own PO back so their AP can match it", () => {
    const rows = blockOfType<KeyValuesBlock>(build(), 'keyValues').rows;

    expect(rows).toContainEqual({ label: 'Your PO', value: 'PO-63075' });
  });

  it('omits the PO row on an order with no PO', () => {
    const rows = blockOfType<KeyValuesBlock>(
      build(order({ poNumber: undefined })),
      'keyValues',
    ).rows;

    expect(rows.map((row) => row.label)).not.toContain('Your PO');
  });

  it('prints the committed lead time — the AC that separates an OC from a quote', () => {
    const rows = blockOfType<KeyValuesBlock>(build(), 'keyValues').rows;

    expect(rows).toContainEqual({
      label: 'Lead time',
      value: '10 calendar days from 2026-08-17',
    });
  });

  it('falls back to the order id before a job number is minted', () => {
    const model = build(order({ jobNumber: undefined }));

    expect(model.title).toBe('Order Confirmation O-3906');
    const rows = blockOfType<KeyValuesBlock>(model, 'keyValues').rows;
    expect(rows.some((r) => r.label === 'Job number')).toBe(false);
  });

  it('states the feet the line was ordered at, not the variant code', () => {
    const model = build(
      order({ lines: [line({ footageVariant: 'long', feetPerRoll: '1250.0000' })] }),
    );
    const rows = blockOfType<LineItemsBlock>(model, 'lineItems').rows;

    expect(rows[0]?.['description']).toBe('DP/24x1250/K47 · Kraft — 47# · 24" × 1,250 ft');
  });

  it('prints no variant code on any roll, as the quote does, and keeps the overwrap', () => {
    const model = build(
      order({
        lines: [
          line({ footageVariant: 'long', feetPerRoll: '1250.0000' }),
          line({
            id: 'oline-2',
            lineNumber: 2,
            footageVariant: 'short',
            feetPerRoll: '960.0000',
            overwrap: true,
          }),
          line({ id: 'oline-3', lineNumber: 3, footageVariant: '500', feetPerRoll: '1480.0000' }),
        ],
      }),
    );
    const rows = blockOfType<LineItemsBlock>(model, 'lineItems').rows;

    expect(rows.map((row) => row['description'])).toEqual([
      'DP/24x1250/K47 · Kraft — 47# · 24" × 1,250 ft',
      'DP/24x960/K47 · Kraft — 47# · 24" × 960 ft · overwrapped',
      'DP/24x1480/K47 · Kraft — 47# · 24" × 1,480 ft',
    ]);
    expect(JSON.stringify(model)).not.toMatch(/\((long|short|500)\)/);
  });

  it('prints the variant alone, and no roll code, on a line with no feet per roll', () => {
    const model = build(
      order({ lines: [line({ footageVariant: 'long', feetPerRoll: undefined })] }),
    );
    const rows = blockOfType<LineItemsBlock>(model, 'lineItems').rows;

    expect(rows[0]?.['description']).toBe('Kraft — 47# · 24" × long');
  });

  it('names the paper the quote named, in the same place, with its code', () => {
    const model = build(
      order({ lines: [line({ footageVariant: 'long', feetPerRoll: '1250.0000' })] }),
      totals(),
      new Map([
        [
          'grade-1',
          { productFamily: 'newsprint', code: '31.4# Newsprint', basisWeightLb: '31.4000' },
        ],
      ]),
    );
    const rows = blockOfType<LineItemsBlock>(model, 'lineItems').rows;

    expect(rows[0]?.['description']).toBe(
      'DP/24x1250/N31.4 · Newsprint — 31.4# Newsprint · 24" × 1,250 ft',
    );
  });

  it('prints a stock width in sixteenths as its fraction', () => {
    const model = build(
      order({
        lines: [line({ rollWidthIn: 11.3125, footageVariant: '500', feetPerRoll: '1480.0000' })],
      }),
      totals(),
      new Map([
        ['grade-1', { productFamily: 'digital_bond', code: '26#', basisWeightLb: '26.0000' }],
      ]),
    );
    const rows = blockOfType<LineItemsBlock>(model, 'lineItems').rows;

    expect(rows[0]?.['description']).toBe('Digital Bond — 26# · 11 5/16" × 1,480 ft');
  });

  it('prints the roll alone for a line whose grade it was not given', () => {
    const model = build(
      order({ lines: [line({ footageVariant: 'long', feetPerRoll: '1250.0000' })] }),
      totals(),
      new Map(),
    );
    const rows = blockOfType<LineItemsBlock>(model, 'lineItems').rows;

    expect(rows[0]?.['description']).toBe('24" × 1,250 ft');
  });

  it('names the delivery method, never the shipping mode', () => {
    const rows = blockOfType<LineItemsBlock>(build(), 'lineItems').rows;

    expect(rows[0]?.['delivery']).toBe('Customer pickup - Demo Printworks plant');

    expect(Object.values(rows[0] ?? {})).not.toContain('pickup');
  });

  it('sends an our_vehicle customer to the Demo Printworks warehouse', () => {
    const model = build(
      order({
        lines: [
          line({
            freight: { mode: 'our_vehicle' },
            freightResult: {
              mode: 'our_vehicle',
              cost: '41.00',
              margin: '0.00',
              invoiceTotal: '41.00',
              pending: false,
            },
          } as Partial<OrderLine>),
        ],
      }),
    );
    const rows = blockOfType<LineItemsBlock>(model, 'lineItems').rows;

    expect(rows[0]?.['delivery']).toBe('Customer pickup - Demo Printworks warehouse');
    expect(Object.values(rows[0] ?? {})).not.toContain('our_vehicle');
  });

  it('prints the total without re-adding freight', () => {
    const block = blockOfType<TotalsBlock>(build(), 'totals');

    expect(block.rows[0]).toMatchObject({ label: 'Total', value: '$1,000.00', emphasis: true });
  });
});

describe('buildOrderConfirmationDocument — a pending carrier bid', () => {
  const pendingOrder = order({
    lines: [
      line({
        freight: { mode: 'carrier' },
        freightResult: {
          mode: 'carrier',
          cost: '0.00',
          margin: '0.00',
          invoiceTotal: '0.00',
          pending: true,
        },
      } as Partial<OrderLine>),
    ],
  });

  it('never prints an unknown freight charge as $0.00', () => {
    const rows = blockOfType<LineItemsBlock>(build(pendingOrder), 'lineItems').rows;

    expect(rows[0]?.['freight']).toBe(FREIGHT_TBD);
  });

  it('says the total is not the final delivered price', () => {
    const model = build(pendingOrder, totals({ freightPending: true }));
    const notice = blockOfType<NoticeBlock>(model, 'notice');

    expect(notice.tone).toBe('warning');
    expect(notice.text).toMatch(/not the final delivered price/);
    expect(blockOfType<TotalsBlock>(model, 'totals').rows[0]?.label).toBe(
      'Total (freight not final)',
    );
  });
});

describe('leadTimeText — calendar days, said out loud', () => {
  it('names the unit, because a reader assumes the wrong one by default', () => {
    expect(leadTimeText(10, '2026-08-17T15:30:00.000Z')).toBe('10 calendar days from 2026-08-17');
    expect(leadTimeText(10, undefined)).toBe('10 calendar days');
  });

  it('never says business days', () => {
    expect(leadTimeText(10, undefined)).not.toMatch(/business/i);
  });

  it('treats 0 as same-day work, not a missing value', () => {
    expect(leadTimeText(0, '2026-08-17T15:30:00.000Z')).toBe('Same day from 2026-08-17');
  });

  it('does not say "1 days"', () => {
    expect(leadTimeText(1, undefined)).toBe('1 calendar day');
  });

  it('derives no delivery date', () => {
    expect(leadTimeText(10, '2026-08-17T15:30:00.000Z')).not.toMatch(/2026-08-27|2026-08-31/);
  });
});

describe('buildOrderConfirmationDocument - the Pacific business day', () => {
  const confirmedRow = (o: OrderWithLines) =>
    blockOfType<KeyValuesBlock>(build(o), 'keyValues').rows.find((row) => row.label === 'Confirmed')
      ?.value;

  it('dates a late-afternoon confirmation by the Pacific day', () => {
    expect(confirmedRow(order({ confirmedAt: '2026-08-19T00:30:00.000Z' }))).toBe('2026-08-18');
  });

  it('anchors the lead time to the same Pacific day the row shows', () => {
    const o = order({ confirmedAt: '2026-08-19T00:30:00.000Z', confirmedLeadTimeDays: 10 });
    const rows = blockOfType<KeyValuesBlock>(build(o), 'keyValues').rows;

    expect(rows).toContainEqual({ label: 'Confirmed', value: '2026-08-18' });
    expect(rows).toContainEqual({
      label: 'Lead time',
      value: '10 calendar days from 2026-08-18',
    });
  });

  it('reads the anchor in Pacific inside leadTimeText itself', () => {
    expect(leadTimeText(10, '2026-08-19T00:30:00.000Z')).toBe('10 calendar days from 2026-08-18');
    expect(leadTimeText(0, '2026-08-19T00:30:00.000Z')).toBe('Same day from 2026-08-18');
  });

  it('is right in winter too - the offset is not hard-coded', () => {
    expect(confirmedRow(order({ confirmedAt: '2026-01-15T00:30:00.000Z' }))).toBe('2026-01-14');
  });
});

describe('buildOrderConfirmationDocument - a line priced per pound', () => {
  const perPound = (overrides: Partial<OrderLine> = {}): OrderLine =>
    line({
      id: 'oline-2',
      lineNumber: 2,
      quantityRolls: 20,
      pricingBasis: 'per_pound',
      productPricePerLb: '0.5772',
      orderedWeightLb: '1000.0000',
      pricePerRoll: '27.3780',
      extendedPrice: '577.2000',
      estimatedWeightLb: '948.6500',
      ...overrides,
    });
  const perRoll = line({ pricingBasis: 'per_roll' });
  const items = (lines: OrderLine[]) =>
    blockOfType<LineItemsBlock>(build(order({ lines })), 'lineItems');

  it('prints per-roll lines with rolls and price per roll', () => {
    const block = items([perRoll]);
    expect(block.columns.map((c) => c.label)).toEqual([
      '#',
      'Description',
      'Rolls',
      'Price / roll',
      'Delivery',
      'Freight',
      'Extended',
    ]);
    expect(block.rows[0]).toMatchObject({
      quantity: '10',
      unitPrice: '$100.00',
      extended: '$1,000.00',
    });
    const model = build(order({ lines: [perRoll] }));
    expect(blockOfType<NoticeBlock | undefined>(model, 'notice')).toBeUndefined();
    expect(blockOfType<TotalsBlock>(model, 'totals').rows[0]?.label).toBe('Total');
  });

  it('prints the pounds ordered, the price per pound and an estimated total', () => {
    const row = items([perPound()]).rows[0];
    expect(row).toMatchObject({
      quantity: '1,000 lb',
      unitPrice: '$0.5772 / lb',
      extended: '$577.20 est.',
    });
    expect(row?.description).toMatch(/ · 20 rolls$/);
    expect(row?.quantity).not.toContain('948.65');
  });

  it('goes unit-neutral when lines are mixed', () => {
    const block = items([perRoll, perPound()]);
    expect(block.columns.map((c) => c.label)).toEqual([
      '#',
      'Description',
      'Qty',
      'Unit price',
      'Delivery',
      'Freight',
      'Extended',
    ]);
    expect(block.rows[0]).toMatchObject({ quantity: '10 rolls', unitPrice: '$100.00 / roll' });
  });

  it("lays its lines out at the quote's widths", () => {
    const widths = [
      { key: 'line', share: 0.25 },
      { key: 'description', share: 3.15 },
      { key: 'quantity', share: 0.75 },
      { key: 'unitPrice', share: 1, gutter: true },
      { key: 'delivery', share: 1.7 },
      { key: 'freight', share: 0.95 },
      { key: 'extended', share: 1 },
    ];
    for (const block of [items([perRoll]), items([perRoll, perPound()])]) {
      expect(block.columns.map(({ key, share, gutter }) => ({ key, share, gutter }))).toEqual(
        widths,
      );
    }
  });

  it('says which weight is billed, and labels the total an estimate', () => {
    const model = build(order({ lines: [perPound()] }));
    const said = blockOfType<NoticeBlock>(model, 'notice');
    expect(said.tone).toBe('info');
    expect(said.text).toContain('show the pounds ordered');
    expect(said.text).toContain('invoiced at the weight measured when the order ships');
    expect(said.text).not.toMatch(/gross|pallet|net/i);
    expect(blockOfType<TotalsBlock>(model, 'totals').rows[0]?.label).toBe('Total (estimated)');
  });
});

describe("buildOrderConfirmationDocument - the customer's names for the goods", () => {
  const described = (lines: OrderLine[]) =>
    blockOfType<LineItemsBlock>(build(order({ lines })), 'lineItems').rows.map(
      (row) => row['description'],
    );

  it('reads roll code, customer description, paper, roll, then part number', () => {
    expect(
      described([
        line({
          footageVariant: 'long',
          feetPerRoll: '1250.0000',
          customerDescription: 'CEDAR CORE SHEET',
          customerPartNumber: 'LN-4417-C',
        }),
      ]),
    ).toEqual([
      'DP/24x1250/K47 · CEDAR CORE SHEET · Kraft — 47# · 24" × 1,250 ft · Part LN-4417-C',
    ]);
  });

  it('prints either one alone', () => {
    expect(
      described([
        line({
          footageVariant: 'long',
          feetPerRoll: '1250.0000',
          customerDescription: 'CEDAR CORE SHEET',
        }),
        line({
          id: 'oline-2',
          lineNumber: 2,
          footageVariant: 'long',
          feetPerRoll: '1250.0000',
          customerPartNumber: 'LN-870',
        }),
      ]),
    ).toEqual([
      'DP/24x1250/K47 · CEDAR CORE SHEET · Kraft — 47# · 24" × 1,250 ft',
      'DP/24x1250/K47 · Kraft — 47# · 24" × 1,250 ft · Part LN-870',
    ]);
  });

  it('keeps the per-pound roll count after the part number', () => {
    const [description] = described([
      line({
        footageVariant: 'long',
        feetPerRoll: '1250.0000',
        quantityRolls: 20,
        pricingBasis: 'per_pound',
        productPricePerLb: '0.5772',
        orderedWeightLb: '1000.0000',
        customerDescription: 'CEDAR CORE SHEET',
        customerPartNumber: 'LN-4417-C',
      }),
    ]);
    expect(description).toBe(
      'DP/24x1250/K47 · CEDAR CORE SHEET · Kraft — 47# · 24" × 1,250 ft · Part LN-4417-C · 20 rolls',
    );
  });
});

describe('the letterhead', () => {
  it('opens with the letterhead and signs every page with the short line', () => {
    const model = build();

    expect(model.blocks[0]).toEqual(letterheadBlock(DEMO_BRAND));
    expect(model.blocks[0]).toEqual({
      type: 'letterhead',
      nameLines: ['DEMO', 'PRINTWORKS'],
      detailLines: ['100 EXAMPLE WAY', 'EXAMPLE CITY, ID 83000', 'TELEPHONE 208-555-0142'],
    });
    expect(model.blocks.filter((block) => block.type === 'letterhead')).toHaveLength(1);
    expect(model.footer).toBe(brandedFooter(DEMO_BRAND, 'Order Confirmation DPW-04718'));
  });
});

describe('buildOrderConfirmationDocument - freight in the price per roll', () => {
  const harbor = (overrides: Partial<OrderLine> = {}): OrderLine =>
    line({
      pricingBasis: 'per_roll',
      freight: { mode: 'our_vehicle' },
      freightResult: {
        mode: 'our_vehicle',
        cost: '58.0000',
        margin: '0.0000',
        invoiceTotal: '58.0000',
        pending: false,
      },
      pricePerRoll: '100.0000',
      extendedPrice: '1058.0000',
      ...overrides,
    });
  const confirm = (lines: OrderLine[], freightInRollPrice?: boolean) =>
    buildOrderConfirmationDocument({
      brand: DEMO_BRAND,
      order: order({ lines }),
      totals: totals({ extendedPrice: '1058.0000' }),
      customerName: 'Acme Papers',
      papers: PAPERS,
      ...(freightInRollPrice === undefined ? {} : { freightInRollPrice }),
    });
  const items = (model: ReturnType<typeof confirm>) =>
    blockOfType<LineItemsBlock>(model, 'lineItems');
  const notices = (model: ReturnType<typeof confirm>) =>
    model.blocks.filter((b): b is NoticeBlock => b.type === 'notice');

  it('prints freight apart when the quote did not set the flag', () => {
    const absent = confirm([harbor()]);
    expect(confirm([harbor()], false)).toEqual(absent);
    expect(items(absent).columns.map((c) => c.label)).toContain('Freight');
    expect(items(absent).rows[0]).toMatchObject({ unitPrice: '$100.00', freight: '$58.00' });
  });

  it('prints as its quote did: the price per roll with freight, no Freight column, one sentence', () => {
    const model = confirm([harbor()], true);
    expect(items(model).columns.map((c) => c.label)).toEqual([
      '#',
      'Description',
      'Rolls',
      'Price / roll incl. freight',
      'Delivery',
      'Extended',
    ]);
    expect(items(model).rows[0]).toMatchObject({
      quantity: '10',
      unitPrice: '$105.80',
      extended: '$1,058.00',
    });
    expect(items(model).rows[0]).not.toHaveProperty('freight');
    expect(notices(model)).toEqual([
      { type: 'notice', tone: 'info', text: "Freight is included in each line's price." },
    ]);
    expect(blockOfType<TotalsBlock>(model, 'totals').rows[0]).toMatchObject({
      label: 'Total',
      value: '$1,058.00',
    });
  });

  it("follows the order's own figures, not the quote's", () => {
    const row = items(confirm([harbor({ quantityRolls: 20, extendedPrice: '2058.0000' })], true))
      .rows[0];
    expect(row?.unitPrice).toBe('$102.90');
    expect(row?.extended).toBe('$2,058.00');
  });

  it('prints what is known and TBD for a line waiting on its carrier bid', () => {
    const model = confirm(
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
    expect(items(model).rows[0]?.unitPrice).toBe(`$100.00 + ${FREIGHT_TBD}`);
    expect(notices(model).map((n) => n.tone)).toEqual(['info', 'warning']);
  });

  it('ignores the flag and prints freight apart while any line is priced per pound', () => {
    const perPound = line({
      id: 'oline-2',
      lineNumber: 2,
      quantityRolls: 20,
      pricingBasis: 'per_pound',
      productPricePerLb: '0.5772',
      orderedWeightLb: '1000.0000',
      pricePerRoll: '27.3780',
      extendedPrice: '577.2000',
      estimatedWeightLb: '948.6500',
    });
    const on = confirm([harbor(), perPound], true);
    expect(on).toEqual(confirm([harbor(), perPound], false));
    expect(items(on).columns.map((c) => c.label)).toEqual([
      '#',
      'Description',
      'Qty',
      'Unit price',
      'Delivery',
      'Freight',
      'Extended',
    ]);
  });
});
