// The Sends fold: each email about this quote, who sent it, and why one failed.
import { FAILURE_NOTICE_ACTOR, type QuoteSendAttempt } from '@erp/types';

import { redirectNote } from '../../../../lib/redirect-note';

type SendTone = 'sent' | 'failed';

interface QuoteSendLine {
  readonly key: string;
  readonly tone: SendTone;

  readonly what: string;

  readonly to: string;
  readonly actor: string;

  readonly submittedAt: string;

  readonly why?: string;
}

export interface QuoteSendEvidence {
  readonly lines: readonly QuoteSendLine[];

  readonly retry?: string;
}

export function sendEvidence(attempts: readonly QuoteSendAttempt[]): QuoteSendEvidence {
  const lines = attempts.map(toLine);
  const retry = retrySentence(attempts);
  return retry === undefined ? { lines } : { lines, retry };
}

function toLine(attempt: QuoteSendAttempt): QuoteSendLine {
  const why = failureSentence(attempt);
  return {
    key: attempt.messageId,
    tone: attempt.outcome === 'accepted' ? 'sent' : 'failed',
    what: headline(attempt),
    to: addresses(attempt),

    actor: attempt.actor === FAILURE_NOTICE_ACTOR ? 'the system, automatically' : attempt.actor,
    submittedAt: attempt.submittedAt,
    ...(why === undefined ? {} : { why }),
  };
}

function headline(attempt: QuoteSendAttempt): string {
  if (attempt.actor === FAILURE_NOTICE_ACTOR) {
    return attempt.outcome === 'accepted'
      ? 'The sender was emailed that an email about this quote failed'
      : 'The sender could not be told that an email about this quote failed';
  }
  if (attempt.audience === 'customer') {
    return attempt.outcome === 'accepted'
      ? 'Emailed to the customer'
      : 'Not emailed to the customer';
  }

  if (attempt.kind === 'lead-time-request') {
    return attempt.outcome === 'accepted'
      ? 'Production asked for a lead time'
      : 'Production was not asked for a lead time';
  }
  return attempt.outcome === 'accepted' ? 'Production told it went out' : 'Production was not told';
}

function addresses(attempt: QuoteSendAttempt): string {
  return attempt.recipients.length === 0
    ? 'no recipients'
    : `${attempt.recipients.join(', ')}${redirectNote(attempt.redirectedTo)}`;
}

function failureSentence(attempt: QuoteSendAttempt): string | undefined {
  if (attempt.outcome !== 'failed') {
    return undefined;
  }

  if (attempt.failureReason === 'no-holders') {
    return 'Nobody holds the Production Manager role, so there was nobody to tell. An administrator grants it on the users screen.';
  }

  if (attempt.failureReason === 'no-addresses') {
    const who = attempt.unreachableHolders.join(', ');
    return `The Production Manager has no email address on record${
      who === '' ? '' : ` (${who})`
    }. An administrator adds one on the users screen.`;
  }

  if (attempt.actor === FAILURE_NOTICE_ACTOR) {
    return 'The mail relay refused it, so whoever sent the quote has not been told that an earlier email about it failed.';
  }

  if (attempt.kind === 'lead-time-request') {
    return 'The mail relay refused it, so production was not emailed for a lead time. The quote still shows in their Needs a lead time queue.';
  }
  return attempt.audience === 'customer'
    ? 'The mail relay refused it, so nobody received this copy. Try again; if it keeps failing, tell an administrator.'
    : 'The mail relay refused it, so production was not told this quote went out. Tell an administrator if it keeps failing.';
}

function retrySentence(attempts: readonly QuoteSendAttempt[]): string | undefined {
  const toCustomer = attempts.filter((attempt) => attempt.audience === 'customer');

  // The send log reads newest first, so the first customer attempt is the latest.
  const latest = toCustomer[0];
  if (latest === undefined || latest.outcome !== 'failed') {
    return undefined;
  }

  const everArrived = toCustomer.some((attempt) => attempt.outcome === 'accepted');
  return everArrived
    ? 'The customer holds an earlier copy, so the button below sends another.'
    : 'Nothing has reached the customer yet. The send button tries again.';
}
