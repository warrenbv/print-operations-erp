// The two ports of the notifications module. `MailSink` hands a message to a relay. `SendLog` records
// every send and every failed attempt in one log, keyed to its quote or order by type and id. See One
// send log in docs/decisions/README.md. Every send in the API goes through
// apps/api/src/notifications/submit-and-record.ts.
import type {
  SendAudience,
  SendKind,
  SendLogEntry,
  SendLogRecord,
  SendSubject,
  SendSubjectType,
} from '@erp/types';

export interface Clock {
  now(): Date;
}

export interface MailAttachment {
  filename: string;
  contentType: string;
  bytes: Uint8Array;
}

export interface OutboundEmail {
  to: readonly string[];
  cc?: readonly string[];
  subject: string;

  textBody: string;
  attachments?: readonly MailAttachment[];
}

export interface MailSubmission {
  messageId: string;
  acceptedByRelayAt: Date;
}

/**
 * `mintMessageId` lets the caller fix the Message-ID before submitting, so the send log, the log
 * lines and every retry carry the same correlation id.
 */
export interface MailSink {
  mintMessageId(): string;

  submit(mail: OutboundEmail, messageId?: string): Promise<MailSubmission>;
}

/**
 * `permanent` marks a rejection the relay will repeat, such as a 5xx reply. A permanent failure is not
 * retried: modules/notifications/src/retrying-mail-sink.ts.
 */
export class MailSubmissionError extends Error {
  readonly attempts: number;

  readonly permanent: boolean;

  constructor(message: string, attempts: number, cause?: unknown, permanent = false) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'MailSubmissionError';
    this.attempts = attempts;
    this.permanent = permanent;
  }
}

/**
 * Append-only. Reads answer newest first by `submittedAt`, ties broken by id, identically in both
 * adapters: modules/notifications/test/contracts/send-log.contract.ts.
 */
export interface SendLog {
  record(entry: SendLogEntry): Promise<SendLogRecord>;

  latestFor(
    subject: SendSubject,
    options?: { audience?: SendAudience; kind?: SendKind },
  ): Promise<SendLogRecord | undefined>;

  latestOfKindFor(
    subjectType: SendSubjectType,
    subjectIds: readonly string[],
    kind: SendKind,
  ): Promise<ReadonlyMap<string, SendLogRecord>>;

  historyFor(
    subject: SendSubject,
    options?: { audience?: SendAudience },
  ): Promise<readonly SendLogRecord[]>;

  /**
   * Internal alerts that could not be sent because nobody could receive them, since `since`. Read by
   * apps/api/src/admin/role-catalog.controller.ts.
   */
  failedInternalAlertsSince(since: Date): Promise<{ count: number; latest?: SendLogRecord }>;
}
