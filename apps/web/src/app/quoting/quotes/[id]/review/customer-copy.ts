// The customer's copy of the quote, as the review and record pages show it.
// It must say what the PDF says. The PDF is modules/documents/src/templates/quote-document.ts, and both are
// held to modules/documents/test/fixtures/quote-copy-parity.json.
import {
  BUSINESS_TELEPHONE,
  businessDayOf,
  deliveredPricePerRollOf,
  deliveryMethodLabel,
  describeGoods,
  formatEstimatedPounds,
  formatMeasure,
  formatMoney,
  formatPricePerPound,
  formatWidthIn,
  freightInRollPriceApplies,
  freightKnowledge,
  linePaperOf,
  PLANT_SITE,
  quoteReference,
  streetLines,
  type FreightResult,
  type Grade,
  type LinePaper,
  type QuoteLine,
  type QuoteTotals,
  type QuoteWithLines,
} from '@erp/types';

interface CopyRow {
  readonly label: string;
  readonly value: string;
}

type CopyColumnKey =
  'line' | 'description' | 'quantity' | 'unitPrice' | 'delivery' | 'freight' | 'extended';

interface CopyColumn {
  readonly key: CopyColumnKey;
  readonly label: string;
  readonly align?: 'right';
}

export interface CustomerCopy {
  readonly letterhead: {
    readonly nameLines: readonly string[];
    readonly detailLines: readonly string[];
  };

  readonly title: string;
  readonly rows: readonly CopyRow[];
  readonly columns: readonly CopyColumn[];

  readonly lines: readonly Readonly<Partial<Record<CopyColumnKey, string>>>[];

  readonly notices: readonly string[];
  readonly total: CopyRow;
  readonly notes?: string;
}

export interface CustomerCopyInput {
  readonly quote: QuoteWithLines;
  readonly totals: QuoteTotals;
  readonly customerName: string;

  readonly salesRepName?: string | undefined;

  readonly papers: ReadonlyMap<string, LinePaper>;
}

export function papersOf(grades: readonly Grade[]): ReadonlyMap<string, LinePaper> {
  return new Map(grades.map((grade) => [grade.id, linePaperOf(grade)]));
}

const LETTERHEAD = {
  nameLines: ['DEMO', 'PRINTWORKS'],
  detailLines: [
    ...streetLines(PLANT_SITE.address).map((line) => line.toUpperCase()),
    `TELEPHONE ${BUSINESS_TELEPHONE}`,
  ],
} as const;

export function customerCopy(input: CustomerCopyInput): CustomerCopy {
  const { quote, totals, customerName } = input;
  const pending = quote.lines.some((line) => line.freightResult.pending);
  const perPound = quote.lines.some(isPricedPerPound);

  const included = freightInRollPriceApplies(quote.freightInRollPrice, quote.lines);
  const labels = priceColumnLabels(perPound, included);

  const notices: string[] = [];
  if (included) {
    notices.push(FREIGHT_INCLUDED_NOTICE);
  }
  if (perPound) {
    notices.push(PER_POUND_NOTICE);
  }
  if (pending) {
    notices.push(PENDING_FREIGHT_NOTICE);
  }

  return {
    letterhead: { nameLines: [...LETTERHEAD.nameLines], detailLines: [...LETTERHEAD.detailLines] },
    title: `Quote ${quoteReference(quote)}`,
    rows: [
      { label: 'Customer', value: customerName },

      { label: 'Date', value: businessDayOf(quote.createdAt) },
      ...(quote.leadTimeDays === undefined
        ? []
        : [{ label: 'Lead time', value: documentLeadTime(quote.leadTimeDays) }]),
      ...(quote.salesRep
        ? [{ label: 'Sales rep', value: input.salesRepName ?? quote.salesRep }]
        : []),
    ],

    columns: copyColumns(labels).filter((column) => !included || column.key !== 'freight'),
    lines: quote.lines.map((line) => {
      const priced = pricedLineCells(line, perPound, included);

      // The copy names the footage the line was priced at, from its cost build-up.
      const effective = { ...line, feetPerRoll: line.cost.feetPerRoll };
      return {
        line: String(line.lineNumber),
        description: `${describeLine(
          `${rollSpecForCustomer(effective)}${line.overwrap ? ' · overwrapped' : ''}`,
          effective,
          input.papers.get(line.gradeId),
        )}${priced.descriptionSuffix}`,
        quantity: priced.quantity,
        unitPrice: priced.unitPrice,
        delivery: deliveryMethodLabel(line.freightResult.mode),
        ...(included ? {} : { freight: freightText(line.freightResult) }),
        extended: priced.extended,
      };
    }),
    notices,
    total: { label: totalLabel(pending, perPound), value: formatMoney(totals.extendedPrice) },
    ...(quote.notes ? { notes: quote.notes } : {}),
  };
}

function copyColumns(labels: { quantity: string; unitPrice: string }): CopyColumn[] {
  return [
    { key: 'line', label: '#' },
    { key: 'description', label: 'Description' },
    { key: 'quantity', label: labels.quantity, align: 'right' },
    { key: 'unitPrice', label: labels.unitPrice, align: 'right' },
    { key: 'delivery', label: 'Delivery' },
    { key: 'freight', label: 'Freight', align: 'right' },
    { key: 'extended', label: 'Extended', align: 'right' },
  ];
}

const FREIGHT_INCLUDED_UNIT_PRICE = 'Price / roll incl. freight';

const FREIGHT_INCLUDED_NOTICE = "Freight is included in each line's price.";

function freightIncludedPrice(line: QuoteLine): string {
  const price = formatMoney(deliveredPricePerRollOf(line));
  return freightKnowledge(line.freightResult) === 'known' ? price : `${price} + ${FREIGHT_TBD}`;
}

function documentLeadTime(days: number): string {
  if (days === 0) return 'Same day';
  return `${String(days)} day${days === 1 ? '' : 's'}`;
}

const PENDING_FREIGHT_NOTICE =
  'Freight on one or more lines is still to be confirmed. The total below ' +
  'does not include that freight in full and is not the final delivered price.';

const PER_POUND_NOTICE =
  'Lines priced by the pound show the pounds ordered. ' +
  'They are invoiced at the weight measured when the order ships.';

const ESTIMATE_MARK = 'est.';

const FREIGHT_TBD = 'TBD';

function freightText(result: FreightResult): string {
  switch (freightKnowledge(result)) {
    case 'known':
      return formatMoney(result.invoiceTotal);
    case 'unknown':
      return FREIGHT_TBD;
    case 'partial':
      return `${formatMoney(result.invoiceTotal)} + ${FREIGHT_TBD}`;
  }
}

function rollSpecForCustomer(line: {
  rollWidthIn: number;
  customWidth?: boolean;
  footageVariant: string;
  feetPerRoll?: string;
}): string {
  const width = `${formatWidthIn(line.rollWidthIn)}${line.customWidth === true ? ' custom' : ''}`;
  return line.feetPerRoll === undefined
    ? `${width} × ${line.footageVariant}`
    : `${width} × ${formatMeasure(line.feetPerRoll)} ft`;
}

function describeLine(
  spec: string,
  line: {
    customerPartNumber?: string | undefined;
    customerDescription?: string | undefined;
    rollWidthIn: number;
    feetPerRoll?: string | undefined;
  },
  paper: LinePaper | undefined,
): string {
  const described = describeGoods(spec, line, paper);
  return line.customerPartNumber === undefined
    ? described
    : `${described} · Part ${line.customerPartNumber}`;
}

function isPricedPerPound(
  line: Pick<QuoteLine, 'pricingBasis' | 'productPricePerLb'>,
): line is Pick<QuoteLine, 'pricingBasis'> & { productPricePerLb: string } {
  return line.pricingBasis === 'per_pound' && line.productPricePerLb !== undefined;
}

function priceColumnLabels(
  unitNeutral: boolean,
  freightIncluded: boolean,
): { quantity: string; unitPrice: string } {
  if (freightIncluded) {
    return { quantity: 'Rolls', unitPrice: FREIGHT_INCLUDED_UNIT_PRICE };
  }
  return unitNeutral
    ? { quantity: 'Qty', unitPrice: 'Unit price' }
    : { quantity: 'Rolls', unitPrice: 'Price / roll' };
}

function rollCount(quantityRolls: number): string {
  return `${String(quantityRolls)} ${quantityRolls === 1 ? 'roll' : 'rolls'}`;
}

function pricedLineCells(
  line: QuoteLine,
  unitNeutral: boolean,
  freightIncluded: boolean,
): { quantity: string; unitPrice: string; extended: string; descriptionSuffix: string } {
  if (isPricedPerPound(line)) {
    return {
      quantity:
        line.orderedWeightLb === undefined
          ? `${formatEstimatedPounds(line.estimatedWeightLb)} lb ${ESTIMATE_MARK}`
          : `${formatMeasure(line.orderedWeightLb)} lb`,
      unitPrice: `${formatPricePerPound(line.productPricePerLb)} / lb`,
      extended: `${formatMoney(line.extendedPrice)} ${ESTIMATE_MARK}`,
      descriptionSuffix: ` · ${rollCount(line.quantityRolls)}`,
    };
  }
  if (freightIncluded) {
    return {
      quantity: String(line.quantityRolls),
      unitPrice: freightIncludedPrice(line),
      extended: formatMoney(line.extendedPrice),
      descriptionSuffix: '',
    };
  }
  return unitNeutral
    ? {
        quantity: rollCount(line.quantityRolls),
        unitPrice: `${formatMoney(line.pricePerRoll)} / roll`,
        extended: formatMoney(line.extendedPrice),
        descriptionSuffix: '',
      }
    : {
        quantity: String(line.quantityRolls),
        unitPrice: formatMoney(line.pricePerRoll),
        extended: formatMoney(line.extendedPrice),
        descriptionSuffix: '',
      };
}

function totalLabel(freightPending: boolean, estimated: boolean): string {
  if (estimated && freightPending) return 'Total (estimated, freight not final)';
  if (estimated) return 'Total (estimated)';
  if (freightPending) return 'Total (freight not final)';
  return 'Total';
}
