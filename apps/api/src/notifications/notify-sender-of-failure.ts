// Sending with a fallback: when a send fails, or an alert has nobody to go to, the person who pressed send gets a notice.
// Unattended sends (actor "system"), unknown actors and actors with no email address are logged and skipped.
import {
  type Clock,
  type MailLog,
  type MailSink,
  type MailSubmission,
  type OutboundEmail,
  type SendLog,
} from '@erp/notifications';
import {
  FAILURE_NOTICE_ACTOR,
  type LabelledSendSubject,
  type SendAudience,
  type SendFailureReason,
  type SendKind,
} from '@erp/types';

import { describeMailFailure } from './describe-mail-failure';
import { failureNoticeMessage, type FailureNotice } from './failure-notice';
import { recordUnsendableAlert } from './record-unsendable-alert';
import { submitAndRecord } from './submit-and-record';

export interface SenderDirectory {
  findByUsername(username: string): Promise<{ email?: string } | null>;
}

export type FailureNotifier = (failure: FailureNotice, actor: string) => Promise<void>;

export interface NotifyingSendDeps {
  mail: MailSink;
  sendLog: SendLog;
  log: MailLog;
  notifySender: FailureNotifier;
  clock?: Clock;
}

const UNATTENDED_ACTOR = 'system';

export function createFailureNotifier(deps: {
  mail: MailSink;
  sendLog: SendLog;
  log: MailLog;
  senders: SenderDirectory;
  clock?: Clock;
}): FailureNotifier {
  return async (failure, actor) => {
    const skip = (reason: string): void => {
      deps.log.info({
        kind: 'mail',
        event: 'failure_notice_skipped',
        reason,
        actor,
        subjectType: failure.subject.type,
        subjectId: failure.subject.id,
      });
    };

    try {
      if (actor === UNATTENDED_ACTOR) {
        skip('unattended-send');
        return;
      }

      const sender = await deps.senders.findByUsername(actor);
      if (sender === null) {
        skip('no-such-user');
        return;
      }
      if (sender.email === undefined || sender.email === '') {
        skip('no-email-address');
        return;
      }

      const message = failureNoticeMessage(failure);
      // `submitAndRecord`, not `sendAndNotify`, so a failed notice can never produce another notice.
      await submitAndRecord(
        { mail: deps.mail, sendLog: deps.sendLog, log: deps.log, ...clockOf(deps) },
        { to: [sender.email], ...message },
        {
          subject: failure.subject,

          audience: 'internal',
          actor: FAILURE_NOTICE_ACTOR,
        },
      );
    } catch (cause) {
      deps.log.error({
        kind: 'mail',
        event: 'failure_notice_failed',
        actor,
        subjectType: failure.subject.type,
        subjectId: failure.subject.id,
        detail: cause instanceof Error ? cause.message : String(cause),
      });
    }
  };
}

/** Notifies the sender of a failure and then rethrows, so the caller's error mapping still answers the request. */
export async function sendAndNotify(
  deps: NotifyingSendDeps,
  email: OutboundEmail,
  about: {
    subject: LabelledSendSubject;
    audience: SendAudience;
    actor: string;

    kind?: SendKind;
  },
): Promise<MailSubmission> {
  try {
    return await submitAndRecord(sendDeps(deps), email, about);
  } catch (cause) {
    await deps.notifySender(
      {
        subject: about.subject,
        audience: about.audience,

        recipients: email.to,
        cause: { kind: 'relay-refused', ...permanence(cause) },
      },
      about.actor,
    );
    throw cause;
  }
}

export async function recordUnsendableAndNotify(
  deps: NotifyingSendDeps,
  about: {
    subject: LabelledSendSubject;
    actor: string;
    reason: SendFailureReason;
    unreachableHolders: readonly string[];

    stands: string;

    kind?: SendKind;
  },
): Promise<void> {
  const { stands, ...recorded } = about;
  await recordUnsendableAlert(sendDeps(deps), recorded);
  await deps.notifySender(
    {
      subject: about.subject,

      audience: 'internal',

      recipients: [],
      cause: {
        kind: 'nobody-to-send-to',
        reason: about.reason,
        unreachableHolders: about.unreachableHolders,
        stands,
      },
    },
    about.actor,
  );
}

function sendDeps(deps: NotifyingSendDeps): {
  mail: MailSink;
  sendLog: SendLog;
  log: MailLog;
  clock?: Clock;
} {
  return { mail: deps.mail, sendLog: deps.sendLog, log: deps.log, ...clockOf(deps) };
}

function clockOf(deps: { clock?: Clock }): { clock?: Clock } {
  return deps.clock === undefined ? {} : { clock: deps.clock };
}

function permanence(cause: unknown): { permanent: boolean; detail?: string } {
  const { failureDetail, failurePermanent } = describeMailFailure(cause);
  return {
    permanent: failurePermanent === true,
    ...(failureDetail === undefined ? {} : { detail: failureDetail }),
  };
}
