// The Billing Manager's cards on Your work: price approvals and credit-hold exceptions, oldest first.
// Both are decided on apps/web/src/app/approvals/page.tsx: docs/product/requirements.md (R2, R7).
import { formatMoney, quoteReference } from '@erp/types';

import type { Workbook } from '../../lib/work/load-workbook';
import { aged, card, customerOf, oldestFirst, type DeskCards } from './cards';

export function billingCards(
  wb: Workbook,
  now: Date,
  repNames: ReadonlyMap<string, string>,
): DeskCards {
  const prices = oldestFirst(
    wb.approvals.flatMap((approval) =>
      approval.kind === 'price-override' && approval.needs.includes('price') ? [approval] : [],
    ),
    (approval) => approval.requestedAt,
  );
  const exceptions = oldestFirst(
    wb.approvals.flatMap((approval) => (approval.kind === 'credit-hold' ? [approval] : [])),
    (approval) => approval.requestedAt,
  );
  const byQuote = new Map(wb.quotes.map((entry) => [entry.quote.id, entry.quote]));

  return {
    cards: {
      'price-approvals': card(
        prices.map((approval) => {
          const quote = byQuote.get(approval.quoteId);

          const price =
            quote === undefined
              ? null
              : quote.manualCount > 1
                ? `${String(quote.manualCount)} hand-set prices`
                : quote.manualPricePerRoll === null
                  ? null
                  : `${formatMoney(quote.manualPricePerRoll)} per roll`;
          const rep =
            approval.salesRep === undefined
              ? null
              : (repNames.get(approval.salesRep) ?? approval.salesRep);
          const tail = [price, rep === null ? null : `asked by ${rep}`].filter(
            (part): part is string => part !== null,
          );
          return {
            href: '/approvals#price-approvals',
            text:
              tail.length === 0
                ? quoteReference(approval)
                : `${quoteReference(approval)} · ${tail.join(', ')}`,
            ...aged(approval.requestedAt, now),
          };
        }),
      ),
      exceptions: card(
        exceptions.map((approval) => ({
          href: '/approvals#exceptions',
          text: customerOf(wb, approval.customerId),
          ...aged(approval.requestedAt, now),
        })),
      ),
    },
    actNow: {
      quotes: prices.map((approval) => approval.quoteId),
      orders: [],
      exceptions: exceptions.map((approval) => approval.approvalId),
    },
  };
}
