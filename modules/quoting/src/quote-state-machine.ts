// The quote state machine. The transition table is `QUOTE_TRANSITIONS` in
// packages/types/src/quote.ts, shared with the web app, and these functions are the only way the
// service reads it. States, and who moves a quote between them: modules/quoting/README.md.
import type { QuoteStatus } from '@erp/types';
import {
  CONVERTIBLE_QUOTE_STATUSES,
  EDITABLE_QUOTE_STATUSES,
  QUOTE_STATUSES,
  QUOTE_TRANSITIONS,
  TERMINAL_QUOTE_STATUSES,
} from '@erp/types';

/** A move the transition table does not allow. `allowed` lists the moves that are. */
export class InvalidQuoteTransitionError extends Error {
  readonly from: QuoteStatus;
  readonly to: QuoteStatus;
  readonly allowed: readonly QuoteStatus[];

  constructor(from: QuoteStatus, to: QuoteStatus) {
    const allowed = QUOTE_TRANSITIONS[from];
    super(
      allowed.length === 0
        ? `a quote in "${from}" is final and cannot move to "${to}"`
        : `a quote in "${from}" cannot move to "${to}" — allowed: ${allowed.join(', ')}`,
    );
    this.name = 'InvalidQuoteTransitionError';
    this.from = from;
    this.to = to;
    this.allowed = allowed;
  }
}

export function canTransition(from: QuoteStatus, to: QuoteStatus): boolean {
  return QUOTE_TRANSITIONS[from].includes(to);
}

export function allowedTransitions(from: QuoteStatus): QuoteStatus[] {
  return [...QUOTE_TRANSITIONS[from]];
}

export function isTerminal(status: QuoteStatus): boolean {
  return QUOTE_TRANSITIONS[status].length === 0;
}

/** Lines, lead time and header can change only in `draft` and `override_requested`. */
export function isEditable(status: QuoteStatus): boolean {
  return EDITABLE_QUOTE_STATUSES.includes(status);
}

/** Only a `quoted` quote converts to an order. */
export function isConvertible(status: QuoteStatus): boolean {
  return CONVERTIBLE_QUOTE_STATUSES.includes(status);
}

export function assertTransition(from: QuoteStatus, to: QuoteStatus): void {
  if (!canTransition(from, to)) {
    throw new InvalidQuoteTransitionError(from, to);
  }
}

// Graph checks on the table. The tests use them to prove every state can still reach a final one.
export function reachableStatuses(from: QuoteStatus = 'draft'): Set<QuoteStatus> {
  const seen = new Set<QuoteStatus>([from]);
  const queue: QuoteStatus[] = [from];

  while (queue.length > 0) {
    const current = queue.shift() as QuoteStatus;
    for (const next of QUOTE_TRANSITIONS[current]) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }

  return seen;
}

/** Non-final states from which no final state is reachable. A sound table returns none. */
export function deadEndStatuses(): QuoteStatus[] {
  return QUOTE_STATUSES.filter((status) => {
    if (isTerminal(status)) {
      return false;
    }
    const reachable = reachableStatuses(status);
    return !TERMINAL_QUOTE_STATUSES.some((terminal) => reachable.has(terminal));
  });
}
