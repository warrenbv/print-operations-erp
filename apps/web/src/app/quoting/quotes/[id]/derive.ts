// Role and status questions the quote pages ask: who may edit the lines, who enters the lead time, and what a decision means now.
// Sales prices and edits a draft. Production or the Production Manager enters the lead time: docs/product/requirements.md (R5).
import type {
  ErpRole,
  Quote,
  QuoteLine,
  QuoteOverrideDecision,
  QuoteOverrideDecisionKind,
  QuoteOverrideKind,
  QuoteSendAttempt,
  QuoteStatus,
  QuoteWithLines,
} from '@erp/types';

import { formatAge, formatDay } from '../../../../lib/dates';
import { mayEnterQuoteLeadTime, maySalesWrite } from '../../../../lib/roles';

export function canWrite(roles: readonly ErpRole[]): boolean {
  return maySalesWrite(roles);
}

export function editable(roles: readonly ErpRole[], status: QuoteStatus): boolean {
  return canWrite(roles) && (status === 'draft' || status === 'override_requested');
}

export function leadTimeEditable(roles: readonly ErpRole[], status: QuoteStatus): boolean {
  return mayEnterQuoteLeadTime(roles) && leadTimeSettable(status);
}

// The lead time is entered only before the quote is sent. A sent quote missing one needs a revision.
function leadTimeSettable(status: QuoteStatus): boolean {
  return status === 'draft' || status === 'override_requested';
}

export function showsLinesStep(status: QuoteStatus): boolean {
  return leadTimeSettable(status);
}

export type LeadTimePanelState = 'enter' | 'waiting' | 'done' | 'none';

export function leadTimePanel(
  roles: readonly ErpRole[],
  status: QuoteStatus,
  leadTimeDays: number | undefined,
): LeadTimePanelState {
  if (!leadTimeSettable(status)) {
    return 'none';
  }
  if (leadTimeDays !== undefined) {
    return 'done';
  }
  return mayEnterQuoteLeadTime(roles) ? 'enter' : 'waiting';
}

export function leadTimeWaitingLine(
  quote: Pick<QuoteWithLines, 'updatedAt'>,
  sends: readonly QuoteSendAttempt[],
  now: Date,
): string {
  const asked = sends.find((send) => send.kind === 'lead-time-request');
  if (asked === undefined) {
    return `Asked ${formatDay(quote.updatedAt)} · ${formatAge(quote.updatedAt, now)}`;
  }
  if (asked.failureReason === 'no-holders') {
    return 'Production has not been told: nobody holds the Production Manager role.';
  }
  if (asked.failureReason === 'no-addresses') {
    return 'Production has not been told: no Production Manager has an email address.';
  }
  if (asked.outcome === 'failed') {
    return 'Production has not been told: the mail server refused the alert.';
  }
  return `Production was told ${formatDay(asked.submittedAt)} · ${formatAge(asked.submittedAt, now)}`;
}

export function leadTimeDoneLine(
  quote: Pick<QuoteWithLines, 'leadTimeDays' | 'leadTimeSetBy' | 'leadTimeSetAt'>,
  enteredByName: string | undefined,
): string {
  const days = quote.leadTimeDays === 0 ? 'same day' : leadTimeLabel(quote.leadTimeDays);
  const name = enteredByName ?? quote.leadTimeSetBy;
  if (name === undefined || quote.leadTimeSetAt === undefined) {
    return `Lead time ${days}.`;
  }
  return `Lead time ${days}, entered by ${name} on ${formatDay(quote.leadTimeSetAt)}.`;
}

export function leadTimeLabel(days: number | undefined): string {
  if (days === undefined) {
    return 'Not set yet';
  }
  if (days === 0) {
    return 'Same day';
  }
  return `${String(days)} ${days === 1 ? 'day' : 'days'}`;
}

export function couldHaveOrder(status: QuoteStatus): boolean {
  return status === 'quoted' || status === 'superseded';
}

export function latestVersion(versions: readonly Quote[]): Quote | undefined {
  return versions[versions.length - 1];
}

export function pendingFreightCount(lines: readonly QuoteLine[]): number {
  return lines.filter((line) => line.freightResult.pending).length;
}

export function manualPriceCount(lines: readonly QuoteLine[]): number {
  return lines.filter((line) => line.priceSource === 'manual').length;
}

export function agreedLineNumbers(
  lines: readonly Pick<QuoteLine, 'lineNumber' | 'priceSource'>[],
): number[] {
  return lines
    .filter((line) => line.priceSource === 'agreed')
    .map((line) => line.lineNumber)
    .sort((a, b) => a - b);
}

export function perPoundCount(lines: readonly QuoteLine[]): number {
  return lines.filter((line) => line.pricingBasis === 'per_pound').length;
}

/** A price approval stands until the lines are edited: docs/product/requirements.md (R7). */
export function approvalLive(quote: Pick<QuoteWithLines, 'overrideApprovedBy'>): boolean {
  return quote.overrideApprovedBy !== undefined;
}

/** An Admin's floor override stands until the lines are edited: docs/product/requirements.md (R6). */
export function floorOverrideLive(quote: Pick<QuoteWithLines, 'floorOverrideBy'>): boolean {
  return quote.floorOverrideBy !== undefined;
}

export function lastDecision(
  decisions: readonly QuoteOverrideDecision[],
): QuoteOverrideDecision | undefined {
  return decisions[decisions.length - 1];
}

export function lastDecisionOf(
  decisions: readonly QuoteOverrideDecision[],
  decision: QuoteOverrideDecisionKind,
  kind: QuoteOverrideKind,
): QuoteOverrideDecision | undefined {
  return [...decisions]
    .reverse()
    .find((entry) => entry.decision === decision && entry.kind === kind);
}

export function floorRejectionSentence(
  decision: Pick<QuoteOverrideDecision, 'actor' | 'reason'>,
): string {
  const why = decision.reason === undefined ? '' : `: "${decision.reason}"`;
  return `Floor override rejected by ${decision.actor}${why} — re-price the line or request approval again.`;
}

/**
 * The last decision, when it is a rejection the quote has not moved past. A rejection returns the
 * quote to draft, so it counts only while the quote is still in draft.
 */
export function freshRejection(
  status: QuoteStatus,
  decisions: readonly QuoteOverrideDecision[],
): QuoteOverrideDecision | undefined {
  const decision = lastDecision(decisions);
  return status === 'draft' && decision !== undefined && decision.decision === 'rejected'
    ? decision
    : undefined;
}
