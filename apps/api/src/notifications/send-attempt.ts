// Maps a send log row to the reply shape of a quote's or an order's send history.
import type { QuoteSendAttempt, SendLogRecord } from '@erp/types';

export function toSendAttempt(record: SendLogRecord): QuoteSendAttempt {
  return {
    messageId: record.messageId,
    recipients: [...record.recipients],
    audience: record.audience,
    actor: record.actor,
    submittedAt: record.submittedAt.toISOString(),
    outcome: record.outcome,

    ...(record.failureReason === undefined ? {} : { failureReason: record.failureReason }),
    unreachableHolders: [...record.unreachableHolders],

    ...(record.redirectedTo === undefined ? {} : { redirectedTo: [...record.redirectedTo] }),

    ...(record.kind === undefined ? {} : { kind: record.kind }),
  };
}
