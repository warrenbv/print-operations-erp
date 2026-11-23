// Builds the quote PDF's document model. Freight prints in its own column, as the `FREIGHT_TBD`
// marker while a carrier bid is pending: docs/product/requirements.md (R4). The quote's
// `freightInRollPrice` setting folds it into the price per roll instead, unless a line is per pound.
// The review step shows the customer the same wording, held together by
// modules/documents/test/fixtures/quote-copy-parity.json.
// Called from apps/api/src/quoting/quotes.controller.ts for the quote's document and its send.
import {
  businessDayOf,
  deliveryMethodLabel,
  formatMoney,
  freightInRollPriceApplies,
  quoteReference,
  type LinePaper,
  type QuoteTotals,
  type QuoteWithLines,
} from '@erp/types';
import { brandedFooter, letterheadBlock, type Brand } from '../brands';
import type { DocumentBlock, DocumentModel } from '../document-model';
import {
  describeLine,
  FREIGHT_INCLUDED_NOTICE,
  freightText,
  isPricedPerPound,
  PER_POUND_NOTICE,
  priceColumnLabels,
  pricedLineCells,
  rollSpecForCustomer,
  totalLabel,
  withoutFreightColumn,
} from './document-formatting';

export { FREIGHT_TBD } from './document-formatting';

const anyFreightPending = (quote: QuoteWithLines): boolean =>
  quote.lines.some((line) => line.freightResult.pending);

export interface QuoteDocumentInput {
  brand: Brand;
  quote: QuoteWithLines;
  totals: QuoteTotals;
  customerName: string;

  papers: ReadonlyMap<string, LinePaper>;

  quotedAt?: string;

  salesRepName?: string;
}

function leadTimeLabel(days: number): string {
  if (days === 0) return 'Same day';
  return `${String(days)} day${days === 1 ? '' : 's'}`;
}

export function buildQuoteDocument(input: QuoteDocumentInput): DocumentModel {
  const { quote, totals, customerName, brand } = input;
  const pending = anyFreightPending(quote);

  const perPound = quote.lines.some(isPricedPerPound);

  const included = freightInRollPriceApplies(quote.freightInRollPrice, quote.lines);
  const labels = priceColumnLabels(perPound, included);

  const blocks: DocumentBlock[] = [
    letterheadBlock(brand),
    {
      type: 'heading',
      title: 'Quote',

      subtitle: quoteReference(quote),
    },
    {
      type: 'keyValues',
      rows: [
        { label: 'Customer', value: customerName },

        // The business day in the plant's time zone, not the UTC day: packages/types/src/business-day.ts.
        { label: 'Date', value: businessDayOf(input.quotedAt ?? quote.createdAt) },

        // Production enters the lead time: docs/product/requirements.md (R5).
        // Until then the row is left out.
        ...(quote.leadTimeDays === undefined
          ? []
          : [{ label: 'Lead time', value: leadTimeLabel(quote.leadTimeDays) }]),
        ...(quote.salesRep
          ? [{ label: 'Sales rep', value: input.salesRepName ?? quote.salesRep }]
          : []),
      ],
    },
    {
      type: 'lineItems',

      columns: [
        { key: 'line', label: '#', share: 0.25 },
        { key: 'description', label: 'Description', share: 3.15 },
        { key: 'quantity', label: labels.quantity, align: 'right', share: 0.75 },
        { key: 'unitPrice', label: labels.unitPrice, align: 'right', share: 1, gutter: true },

        { key: 'delivery', label: 'Delivery', share: 1.7 },
        { key: 'freight', label: 'Freight', align: 'right', share: 0.95 },
        { key: 'extended', label: 'Extended', align: 'right', share: 1 },
      ],
      rows: quote.lines.map((line) => {
        const priced = pricedLineCells(line, perPound, included);

        // The roll prints the feet per roll the line was priced on, from its cost build-up.
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
          freight: freightText(line.freightResult),
          extended: priced.extended,
        };
      }),
    },
  ];

  if (included) {
    const at = blocks.findIndex((block) => block.type === 'lineItems');
    const table = blocks[at];
    if (table?.type === 'lineItems') {
      blocks[at] = withoutFreightColumn(table);
    }
    blocks.push({ type: 'notice', tone: 'info', text: FREIGHT_INCLUDED_NOTICE });
  }

  if (perPound) {
    blocks.push({ type: 'notice', tone: 'info', text: PER_POUND_NOTICE });
  }

  if (pending) {
    blocks.push({
      type: 'notice',
      tone: 'warning',
      text:
        'Freight on one or more lines is still to be confirmed. The total below ' +
        'does not include that freight in full and is not the final delivered price.',
    });
  }

  blocks.push({
    type: 'totals',
    rows: [
      {
        label: totalLabel(pending, perPound),
        value: formatMoney(totals.extendedPrice),
        emphasis: true,
      },
    ],
  });

  if (quote.notes) {
    blocks.push({ type: 'prose', heading: 'Notes', text: quote.notes });
  }

  return {
    title: `Quote ${quoteReference(quote)}`,
    blocks,

    footer: brandedFooter(brand, `Quote ${quoteReference(quote)}`),
  };
}
