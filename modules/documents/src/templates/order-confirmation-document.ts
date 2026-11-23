// Builds the order confirmation's document model from the order's own copied lines and totals, not
// the quote's: docs/product/requirements.md (R9). Only the freight-in-price setting comes from the
// quote, passed in by apps/api/src/orders/orders.controller.ts.
import {
  businessDayOf,
  deliveryMethodLabel,
  formatMoney,
  freightInRollPriceApplies,
  type LinePaper,
  type OrderTotals,
  type OrderWithLines,
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

/**
 * The committed lead time in calendar days, said out loud and counted from the confirmation's
 * business day. No delivery date is derived: docs/product/requirements.md (R11).
 */
export function leadTimeText(days: number, confirmedAt: string | undefined): string {
  const anchor = confirmedAt === undefined ? undefined : businessDayOf(confirmedAt);
  const from = anchor === undefined ? '' : ` from ${anchor}`;
  if (days === 0) return `Same day${from}`;
  return `${days} calendar ${days === 1 ? 'day' : 'days'}${from}`;
}

interface OrderConfirmationDocumentInput {
  brand: Brand;
  order: OrderWithLines;
  totals: OrderTotals;
  customerName: string;

  papers: ReadonlyMap<string, LinePaper>;

  salesRepName?: string;

  freightInRollPrice?: boolean;
}

export function buildOrderConfirmationDocument(
  input: OrderConfirmationDocumentInput,
): DocumentModel {
  const { order, totals, customerName, brand } = input;
  const pending = order.lines.some((line) => line.freightResult.pending);

  const perPound = order.lines.some(isPricedPerPound);

  const included = freightInRollPriceApplies(input.freightInRollPrice ?? false, order.lines);
  const labels = priceColumnLabels(perPound, included);

  const reference = order.jobNumber ?? order.id;

  const blocks: DocumentBlock[] = [
    letterheadBlock(brand),
    {
      type: 'heading',
      title: 'Order Confirmation',
      subtitle: reference,
    },
    {
      type: 'keyValues',
      rows: [
        { label: 'Customer', value: customerName },
        ...(order.jobNumber ? [{ label: 'Job number', value: order.jobNumber }] : []),

        ...(order.poNumber ? [{ label: 'Your PO', value: order.poNumber }] : []),
        ...(order.confirmedAt
          ? [{ label: 'Confirmed', value: businessDayOf(order.confirmedAt) }]
          : []),

        ...(order.confirmedLeadTimeDays === undefined
          ? []
          : [
              {
                label: 'Lead time',
                value: leadTimeText(order.confirmedLeadTimeDays, order.confirmedAt),
              },
            ]),
        ...(order.salesRep
          ? [{ label: 'Sales rep', value: input.salesRepName ?? order.salesRep }]
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
      rows: order.lines.map((line) => {
        const priced = pricedLineCells(line, perPound, included);
        return {
          line: String(line.lineNumber),

          description: `${describeLine(
            `${rollSpecForCustomer(line)}${line.overwrap ? ' · overwrapped' : ''}`,
            line,
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

  return {
    title: `Order Confirmation ${reference}`,
    blocks,
    footer: brandedFooter(brand, `Order Confirmation ${reference}`),
  };
}
