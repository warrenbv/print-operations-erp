// Where a customer on credit hold stands on an exception, as the quote screens show it.
// A hold blocks a new quote, and an approved exception permits exactly one: docs/product/requirements.md (R2).
// Shown by apps/web/src/app/quoting/credit-hold-notice.tsx on New quote, the quote page and the customer page.
import type { Customer, QuoteApproval } from '@erp/types';

export type CreditExceptionState =
  | { readonly kind: 'not-held' }
  | { readonly kind: 'may-ask' }
  | { readonly kind: 'pending'; readonly approval: QuoteApproval }
  | { readonly kind: 'approved'; readonly approval: QuoteApproval }
  | { readonly kind: 'rejected'; readonly approval: QuoteApproval };

export function creditExceptionState(
  customer: Pick<Customer, 'creditHold'>,
  approvals: readonly QuoteApproval[],
): CreditExceptionState {
  if (!customer.creditHold) {
    return { kind: 'not-held' };
  }

  // An approved exception not yet spent comes first, whatever was asked since, because it is
  // what lets Sales start the one quote it permits.
  const unspent = approvals.find(
    (approval) => approval.status === 'approved' && approval.spentByQuoteId === undefined,
  );
  if (unspent !== undefined) {
    return { kind: 'approved', approval: unspent };
  }

  const pending = newest(approvals.filter((approval) => approval.status === 'pending'));
  if (pending !== undefined) {
    return { kind: 'pending', approval: pending };
  }

  const rejected = newest(approvals.filter((approval) => approval.status === 'rejected'));
  if (rejected !== undefined) {
    return { kind: 'rejected', approval: rejected };
  }

  return { kind: 'may-ask' };
}

export function offersRequestForm(state: CreditExceptionState): boolean {
  return state.kind === 'may-ask' || state.kind === 'rejected';
}

/**
 * Whether the page offers Start quote. It decides nothing: the API refuses a held customer at
 * creation unless it can spend an approved exception, in modules/quoting/src/services/quote-service.ts.
 */
export function mayStartQuote(state: CreditExceptionState): boolean {
  return state.kind === 'not-held' || state.kind === 'approved';
}

function newest(approvals: readonly QuoteApproval[]): QuoteApproval | undefined {
  let latest: QuoteApproval | undefined;
  for (const approval of approvals) {
    if (latest === undefined || approval.requestedAt > latest.requestedAt) {
      latest = approval;
    }
  }
  return latest;
}
