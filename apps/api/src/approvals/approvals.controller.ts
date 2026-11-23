// The Approvals queue: credit-hold exceptions and quotes parked in `override_requested`, composed into one list.
// The rules behind each kind: docs/product/requirements.md (R2) for exceptions, (R6) for the floor and (R7) for a hand-set price.
// Each item is decided on its own route, in apps/api/src/quoting/credit-approvals.controller.ts or apps/api/src/quoting/quotes.controller.ts.
import { Controller, Get, Inject } from '@nestjs/common';
import { QuoteService } from '@erp/quoting';
import {
  pendingApprovalListResponseSchema,
  type PendingApproval,
  type PendingApprovalListResponse,
  type QuoteListItem,
  type QuoteOverrideKind,
} from '@erp/types';

import { Authenticated } from '../auth/authz.decorators';

/** What a parked quote still needs decided. A quote that owes nothing is left out of the queue. */
function owedDecisions(quote: QuoteListItem): QuoteOverrideKind[] {
  const needs: QuoteOverrideKind[] = [];
  if (quote.manualCount > 0 && quote.overrideApprovedBy === undefined) {
    needs.push('price');
  }
  if (quote.belowFloorCount > 0 && quote.floorOverrideBy === undefined) {
    needs.push('floor');
  }
  return needs;
}

@Controller('approvals')
export class ApprovalsController {
  constructor(@Inject(QuoteService) private readonly quotes: QuoteService) {}

  @Authenticated()
  @Get('pending')
  async pending(): Promise<PendingApprovalListResponse> {
    const [creditHolds, overrideQuotes] = await Promise.all([
      this.quotes.listPendingApprovals(),
      this.quotes.list({ status: 'override_requested' }),
    ]);

    const items: PendingApproval[] = [
      ...creditHolds.map((approval): PendingApproval => ({
        kind: 'credit-hold',
        approvalId: approval.id,
        customerId: approval.customerId,
        reason: approval.reason,
        requestedBy: approval.requestedBy,
        requestedAt: approval.requestedAt,
      })),

      ...[...overrideQuotes]
        .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))
        .flatMap((quote): PendingApproval[] => {
          const needs = owedDecisions(quote);
          return needs.length === 0
            ? []
            : [
                {
                  kind: 'price-override',
                  quoteId: quote.id,
                  customerId: quote.customerId,
                  quoteNumber: quote.quoteNumber,
                  versionNumber: quote.versionNumber,
                  ...(quote.salesRep === undefined ? {} : { salesRep: quote.salesRep }),
                  requestedAt: quote.updatedAt,
                  needs,
                },
              ];
        }),
    ];

    return pendingApprovalListResponseSchema.parse({ items });
  }
}
