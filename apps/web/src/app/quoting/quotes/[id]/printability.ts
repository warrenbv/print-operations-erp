// Whether a quote can produce its customer PDF, and what blocks it.
// The document passes the same gates as a send: the floor (docs/product/requirements.md (R6)), the price
// approval (docs/product/requirements.md (R7)) and the lead time (docs/product/requirements.md (R5)).
import { PRINTABLE_QUOTE_STATUSES, type QuoteSendability, type QuoteStatus } from '@erp/types';

type BelowFloorLines = Extract<QuoteSendability, { sendable: false }>['belowFloor'];

export type QuoteDocumentState =
  | { kind: 'not-printable'; status: QuoteStatus }
  | { kind: 'blocked-below-floor'; belowFloor: BelowFloorLines }
  | { kind: 'blocked-unapproved-override'; manualCount: number }
  | { kind: 'blocked-no-lead-time' }
  | { kind: 'ready' };

export function quoteDocumentState(input: {
  status: QuoteStatus;
  sendability: QuoteSendability;
  manualCount: number;
  approvalLive: boolean;
  leadTimeDays: number | undefined;
}): QuoteDocumentState {
  const { status, sendability, manualCount, approvalLive, leadTimeDays } = input;

  if (!PRINTABLE_QUOTE_STATUSES.includes(status)) {
    return { kind: 'not-printable', status };
  }
  // The API's sendability already counts a live floor override as release, so this holds for Admin too.
  if (sendability.sendable === false) {
    return { kind: 'blocked-below-floor', belowFloor: sendability.belowFloor };
  }
  if (manualCount > 0 && !approvalLive) {
    return { kind: 'blocked-unapproved-override', manualCount };
  }

  if (leadTimeDays === undefined) {
    return { kind: 'blocked-no-lead-time' };
  }
  return { kind: 'ready' };
}

export function offersDocument(state: QuoteDocumentState): boolean {
  return state.kind === 'ready';
}
