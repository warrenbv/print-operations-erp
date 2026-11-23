// Records an internal alert that had nobody to go to, as a failed send log row with no recipients.
// A failed log write is logged, not thrown, because the act that raised the alert has already happened.
import { type Clock, type MailLog, type MailSink, type SendLog } from '@erp/notifications';
import type { LabelledSendSubject, SendFailureReason, SendKind } from '@erp/types';

import { apiClock } from '../test-clock';

export async function recordUnsendableAlert(
  deps: { mail: MailSink; sendLog: SendLog; log: MailLog; clock?: Clock },
  about: {
    subject: LabelledSendSubject;
    actor: string;
    reason: SendFailureReason;
    unreachableHolders: readonly string[];

    kind?: SendKind;
  },
): Promise<void> {
  const clock = deps.clock ?? apiClock;
  const messageId = deps.mail.mintMessageId();
  try {
    await deps.sendLog.record({
      messageId,
      subject: { type: about.subject.type, id: about.subject.id },
      subjectLabel: about.subject.label,

      recipients: [],

      audience: 'internal',
      actor: about.actor,
      submittedAt: clock.now(),
      outcome: 'failed',
      failureReason: about.reason,
      unreachableHolders: about.unreachableHolders,
      ...(about.kind === undefined ? {} : { kind: about.kind }),
    });
  } catch (cause) {
    deps.log.error({
      kind: 'mail',
      event: 'send_log_write_failed',
      messageId,
      subjectType: about.subject.type,
      subjectId: about.subject.id,
      outcome: 'failed',
      detail: cause instanceof Error ? cause.message : String(cause),
    });
  }
}
