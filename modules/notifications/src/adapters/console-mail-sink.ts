// The `MailSink` used when mail is not configured or storage is in memory, as in the demo. It writes
// each message as one JSON line to the console and accepts it, which is where the demo's quote email
// appears: docs/product/requirements.md (R8). Chosen in apps/api/src/notifications/notifications.factory.ts.
import { newMessageId } from '../message';
import type { Clock, MailSink, MailSubmission, OutboundEmail } from '../ports';

export class ConsoleMailSink implements MailSink {
  constructor(
    private readonly clock: Clock,
    private readonly fromAddress = 'erp@example.test',
  ) {}

  mintMessageId(): string {
    return newMessageId(this.fromAddress);
  }

  async submit(mail: OutboundEmail, messageId = this.mintMessageId()): Promise<MailSubmission> {
    const submission: MailSubmission = {
      messageId,
      acceptedByRelayAt: this.clock.now(),
    };
    console.info(
      JSON.stringify({
        kind: 'mail',
        event: 'mail_console_sink',
        messageId: submission.messageId,
        to: mail.to,
        cc: mail.cc ?? [],
        subject: mail.subject,
        textBody: mail.textBody,
        attachments: (mail.attachments ?? []).map((a) => ({
          filename: a.filename,
          contentType: a.contentType,
          byteSize: a.bytes.byteLength,
        })),
        at: submission.acceptedByRelayAt.toISOString(),
      }),
    );
    return submission;
  }
}
