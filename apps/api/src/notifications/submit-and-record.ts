// Submits one email and writes one send log row for it, accepted or failed. One row per logical send, not per retry.
// The message id is minted before submission, so a failed row still carries a real correlation id.
import {
  type Clock,
  type MailLog,
  type MailSink,
  type MailSubmission,
  type OutboundEmail,
  type SendLog,
} from '@erp/notifications';
import type { LabelledSendSubject, SendAudience, SendKind } from '@erp/types';

import { apiClock } from '../test-clock';
import { describeMailFailure } from './describe-mail-failure';
import { redirectedTo } from './redirected-to';

export async function submitAndRecord(
  deps: { mail: MailSink; sendLog: SendLog; log: MailLog; clock?: Clock },
  email: OutboundEmail,
  about: {
    subject: LabelledSendSubject;
    audience: SendAudience;
    actor: string;

    kind?: SendKind;
  },
): Promise<MailSubmission> {
  const { subject } = about;
  const clock = deps.clock ?? apiClock;
  const messageId = deps.mail.mintMessageId();

  const actual = redirectedTo(deps.mail, email.to);

  const record = async (
    outcome: 'accepted' | 'failed',
    submittedAt: Date,
    id: string,

    failure: { failureDetail?: string; failurePermanent?: boolean } = {},
  ): Promise<void> => {
    try {
      await deps.sendLog.record({
        messageId: id,

        subject: { type: subject.type, id: subject.id },
        subjectLabel: subject.label,

        recipients: email.to,
        ...(actual === undefined ? {} : { redirectedTo: actual }),
        audience: about.audience,
        ...(about.kind === undefined ? {} : { kind: about.kind }),
        actor: about.actor,
        submittedAt,
        outcome,
        ...failure,
      });
    } catch (cause) {
      // A log write that fails is logged and swallowed. It must neither report a sent mail as failed nor hide why a send failed.
      deps.log.error({
        kind: 'mail',
        event: 'send_log_write_failed',
        messageId: id,

        subjectType: subject.type,
        subjectId: subject.id,
        outcome,
        detail: cause instanceof Error ? cause.message : String(cause),
      });
    }
  };

  let submission: MailSubmission;
  try {
    submission = await deps.mail.submit(email, messageId);
  } catch (cause) {
    await record('failed', clock.now(), messageId, describeMailFailure(cause));
    throw cause;
  }

  await record('accepted', submission.acceptedByRelayAt, submission.messageId);
  return submission;
}
