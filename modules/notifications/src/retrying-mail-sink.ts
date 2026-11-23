// Retries a transient submission failure on a fixed backoff and gives up at once on a permanent
// rejection. Every attempt uses the same Message-ID, and each outcome is logged as one JSON line.
import {
  MailSubmissionError,
  type MailSink,
  type MailSubmission,
  type OutboundEmail,
} from './ports';

export interface RetryPolicy {
  attempts: number;
  delaysMs: readonly number[];
}

// The send runs while the request waits. These delays and `SMTP_TIMEOUTS` together are held to the
// budget pinned in modules/notifications/test/smtp-mail-sink.test.ts.
export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  attempts: 3,
  delaysMs: [1_000, 5_000],
};

export interface MailLog {
  info(line: Record<string, unknown>): void;
  warn(line: Record<string, unknown>): void;
  error(line: Record<string, unknown>): void;
}

export const consoleMailLog: MailLog = {
  info: (line) => console.info(JSON.stringify(line)),
  warn: (line) => console.warn(JSON.stringify(line)),
  error: (line) => console.error(JSON.stringify(line)),
};

export class RetryingMailSink implements MailSink {
  constructor(
    private readonly inner: MailSink,
    private readonly log: MailLog = consoleMailLog,
    private readonly policy: RetryPolicy = DEFAULT_RETRY_POLICY,

    private readonly sleep: (ms: number) => Promise<void> = (ms) =>
      new Promise((resolve) => setTimeout(resolve, ms)),
  ) {}

  mintMessageId(): string {
    return this.inner.mintMessageId();
  }

  async submit(mail: OutboundEmail, messageId = this.mintMessageId()): Promise<MailSubmission> {
    let lastCause: unknown;
    for (let attempt = 1; attempt <= this.policy.attempts; attempt++) {
      try {
        const submission = await this.inner.submit(mail, messageId);
        this.log.info({
          kind: 'mail',
          event: 'mail_submitted',
          messageId: submission.messageId,
          to: mail.to,
          subject: mail.subject,
          attempt,
          at: submission.acceptedByRelayAt.toISOString(),
        });
        return submission;
      } catch (cause) {
        lastCause = cause;

        if (cause instanceof MailSubmissionError && cause.permanent) {
          this.log.error({
            kind: 'mail',
            event: 'mail_submission_rejected',
            messageId,
            to: mail.to,
            subject: mail.subject,
            attempt,
            error: cause.message,
          });
          throw new MailSubmissionError(
            `mail submission was permanently rejected on attempt ${attempt}`,
            attempt,
            cause,
            true,
          );
        }

        this.log.warn({
          kind: 'mail',
          event: 'mail_submission_retry',
          messageId,
          to: mail.to,
          subject: mail.subject,
          attempt,
          of: this.policy.attempts,
          error: cause instanceof Error ? cause.message : String(cause),
        });
        if (attempt < this.policy.attempts) {
          await this.sleep(this.policy.delaysMs[attempt - 1] ?? 0);
        }
      }
    }
    this.log.error({
      kind: 'mail',
      event: 'mail_submission_failed',
      messageId,
      to: mail.to,
      subject: mail.subject,
      attempts: this.policy.attempts,
      error: lastCause instanceof Error ? lastCause.message : String(lastCause),
    });
    throw new MailSubmissionError(
      `mail submission failed after ${this.policy.attempts} attempts`,
      this.policy.attempts,
      lastCause,
    );
  }
}
