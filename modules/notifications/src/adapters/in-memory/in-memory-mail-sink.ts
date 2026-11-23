// A `MailSink` for tests. It records each submission and can inject transient or permanent failures.
import { newMessageId } from '../../message';
import {
  MailSubmissionError,
  type Clock,
  type MailSink,
  type MailSubmission,
  type OutboundEmail,
} from '../../ports';

export interface RecordedSubmission {
  mail: OutboundEmail;
  submission: MailSubmission;
}

export class InMemoryMailSink implements MailSink {
  readonly submissions: RecordedSubmission[] = [];

  readonly attemptedMessageIds: string[] = [];
  private failuresRemaining = 0;
  private failuresArePermanent = false;

  constructor(
    private readonly clock: Clock,
    private readonly fromAddress = 'erp@example.test',
  ) {}

  failNextSubmissions(count: number): void {
    this.failuresRemaining = count;
  }

  rejectNextSubmissions(count: number): void {
    this.failuresRemaining = count;
    this.failuresArePermanent = true;
  }

  mintMessageId(): string {
    return newMessageId(this.fromAddress);
  }

  async submit(mail: OutboundEmail, messageId = this.mintMessageId()): Promise<MailSubmission> {
    this.attemptedMessageIds.push(messageId);
    if (this.failuresRemaining > 0) {
      this.failuresRemaining -= 1;
      throw new MailSubmissionError(
        this.failuresArePermanent ? 'injected permanent rejection' : 'injected failure',
        1,
        undefined,
        this.failuresArePermanent,
      );
    }
    const submission: MailSubmission = {
      messageId,
      acceptedByRelayAt: this.clock.now(),
    };
    this.submissions.push({ mail, submission });
    return submission;
  }
}
