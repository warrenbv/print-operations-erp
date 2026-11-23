// Which send act a quote offers, from the API's sendability and the price approvals.
// A line below the margin floor goes out only with an Admin's override: docs/product/requirements.md (R6).
// A hand-set price needs the Billing Manager's approval: docs/product/requirements.md (R7).
// Read by apps/web/src/app/quoting/quotes/[id]/review/gates.ts and apps/web/src/lib/work/quote-next-step.ts.
import type { QuoteSendability, QuoteStatus } from '@erp/types';

type BelowFloorLines = Extract<QuoteSendability, { sendable: false }>['belowFloor'];

export type SendAction =
  | {
      kind: 'needs-floor-override';
      belowFloor: BelowFloorLines;

      requested: boolean;
      manualCount: number;
    }
  | { kind: 'override-floor'; belowFloor: BelowFloorLines; manualCount: number }
  | { kind: 'needs-approval'; manualCount: number }
  | { kind: 'awaiting-approval'; manualCount: number }
  | { kind: 'sendable' };

export function sendAction(input: {
  status: QuoteStatus;
  sendability: QuoteSendability;
  manualCount: number;
  approvalLive: boolean;
  floorOverrider: boolean;
}): SendAction {
  const { status, sendability, manualCount, approvalLive, floorOverrider } = input;

  // The floor comes first: no price approval releases a below-floor line, docs/product/requirements.md (R6).
  // `manualCount` then counts only hand-set prices still owing the Billing Manager's approval.
  if (sendability.sendable === false) {
    const owed = approvalLive ? 0 : manualCount;
    return floorOverrider
      ? { kind: 'override-floor', belowFloor: sendability.belowFloor, manualCount: owed }
      : {
          kind: 'needs-floor-override',
          belowFloor: sendability.belowFloor,
          requested: status === 'override_requested',
          manualCount: owed,
        };
  }
  if (manualCount > 0 && !approvalLive) {
    return status === 'draft'
      ? { kind: 'needs-approval', manualCount }
      : { kind: 'awaiting-approval', manualCount };
  }
  return { kind: 'sendable' };
}

export function offersSend(action: SendAction): boolean {
  return action.kind === 'sendable';
}
