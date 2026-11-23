// Pure helpers for the Approvals page: splitting the pending list by kind, ordering the kinds by their
// oldest item, and the sentences a price decision shows.
// A hand-set price is the Billing Manager's decision and a line below the floor is an Admin's:
// docs/product/requirements.md (R6, R7).
import {
  formatMoney,
  type PendingApproval,
  type PendingCreditHold,
  type PendingPriceOverride,
  type QuoteLine,
  type QuoteOverrideKind,
} from '@erp/types';

import { marginEnteredWords } from '../quoting/format';

export interface PartitionedApprovals {
  readonly creditHolds: readonly PendingCreditHold[];
  readonly priceOverrides: readonly PendingPriceOverride[];
}

export function partitionApprovals(items: readonly PendingApproval[]): PartitionedApprovals {
  const creditHolds: PendingCreditHold[] = [];
  const priceOverrides: PendingPriceOverride[] = [];
  for (const item of items) {
    if (item.kind === 'credit-hold') creditHolds.push(item);
    else priceOverrides.push(item);
  }
  return { creditHolds, priceOverrides };
}

export type ApprovalKind = 'price-approvals' | 'exceptions';

export function orderKinds(partitioned: PartitionedApprovals): readonly ApprovalKind[] {
  const kinds: readonly { kind: ApprovalKind; oldest: string | undefined }[] = [
    { kind: 'price-approvals', oldest: oldestOf(partitioned.priceOverrides) },
    { kind: 'exceptions', oldest: oldestOf(partitioned.creditHolds) },
  ];
  const waiting = kinds
    .filter((entry) => entry.oldest !== undefined)

    .sort((a, b) => ((a.oldest ?? '') < (b.oldest ?? '') ? -1 : a.oldest === b.oldest ? 0 : 1));
  const empty = kinds.filter((entry) => entry.oldest === undefined);
  return [...waiting, ...empty].map((entry) => entry.kind);
}

function oldestOf(items: readonly { requestedAt: string }[]): string | undefined {
  return items.reduce<string | undefined>(
    (oldest, item) =>
      oldest === undefined || item.requestedAt < oldest ? item.requestedAt : oldest,
    undefined,
  );
}

export function approvalAskers(items: readonly PendingApproval[]): string[] {
  return items.flatMap((item) =>
    item.kind === 'price-override'
      ? item.salesRep === undefined
        ? []
        : [item.salesRep]
      : [item.requestedBy],
  );
}

export function approvalCustomerIds(items: readonly PendingApproval[]): string[] {
  return items.map((item) => item.customerId);
}

export function handSetLines(lines: readonly QuoteLine[]): readonly QuoteLine[] {
  return lines.filter((line) => line.priceSource === 'manual');
}

export function needsWords(needs: readonly QuoteOverrideKind[]): string {
  const words: Record<QuoteOverrideKind, string> = {
    price: 'hand-set price',
    floor: 'below the floor',
  };
  return `Needs: ${needs.map((kind) => words[kind]).join(' and ')}`;
}

export function handSetReason(
  line: Pick<QuoteLine, 'lineNumber' | 'pricingBasis' | 'floor'>,
): string {
  const basis = line.pricingBasis === 'per_pound' ? 'price per pound' : 'price per roll';
  const floor =
    line.floor.status === 'below_floor'
      ? 'Its margin is below the floor, and overriding the floor is a separate decision for an Admin.'
      : 'Its margin meets the floor, so the floor is not why it needs approval.';
  return [
    `Line ${String(line.lineNumber)}'s ${basis} was typed by hand.`,
    "Every hand-set price needs the Billing Manager's approval, whatever its margin.",
    floor,
  ].join(' ');
}

export interface BelowFloorLine {
  readonly lineNumber: number;
  readonly minimumPricePerRoll: string;
}

export function belowFloorLines(lines: readonly QuoteLine[]): readonly BelowFloorLine[] {
  return lines.flatMap((line) =>
    line.floor.status === 'below_floor'
      ? [{ lineNumber: line.lineNumber, minimumPricePerRoll: line.floor.minimumPricePerRoll }]
      : [],
  );
}

export function belowFloorSentence(line: BelowFloorLine): string {
  return `Below the floor on line ${String(line.lineNumber)}, minimum ${formatMoney(line.minimumPricePerRoll)}.`;
}

export function enteredMarginSentence(
  line: Pick<QuoteLine, 'lineNumber' | 'marginOverridePct'>,
): string {
  return line.marginOverridePct === undefined
    ? ''
    : `Line ${String(line.lineNumber)} has a ${marginEnteredWords(
        line.marginOverridePct,
      )}, and is not part of this decision.`;
}

export function agreedPriceSentence(line: Pick<QuoteLine, 'lineNumber'>): string {
  return `Line ${String(line.lineNumber)} is at the customer’s agreed price and needs no approval.`;
}

export function tierLineCount(
  lines: readonly Pick<QuoteLine, 'priceSource' | 'marginOverridePct' | 'floor'>[],
): number {
  return lines.filter(
    (line) =>
      line.priceSource !== 'manual' &&
      line.priceSource !== 'agreed' &&
      line.marginOverridePct === undefined &&
      line.floor.status !== 'below_floor',
  ).length;
}
