// The email that tells a sender their email did not go out: what it was, who it was for, why, and what to do next.
// Sent by apps/api/src/notifications/notify-sender-of-failure.ts. Tests: apps/api/test/failure-notice.test.ts.
import {
  sendSubjectName,
  type LabelledSendSubject,
  type SendAudience,
  type SendFailureReason,
  type SendSubjectType,
} from '@erp/types';

type NoticeCause =
  | {
      kind: 'relay-refused';

      permanent: boolean;

      detail?: string;
    }
  | {
      kind: 'nobody-to-send-to';
      reason: SendFailureReason;
      // Holders of the addressed role who have no email address on record.
      unreachableHolders: readonly string[];
      // A sentence on what still happened, such as the order being recorded.
      stands: string;
    };

export interface FailureNotice {
  subject: LabelledSendSubject;
  audience: SendAudience;

  recipients: readonly string[];
  cause: NoticeCause;
}

export interface NoticeMessage {
  subject: string;
  textBody: string;
}

export function failureNoticeMessage(notice: FailureNotice): NoticeMessage {
  const { type, id, label } = notice.subject;

  const name = sendSubjectName(type, id, label);
  const named = name.charAt(0).toLowerCase() + name.slice(1);

  const paragraphs = [
    `${whatWasSent(notice)} did not go out.`,
    addressee(notice),
    whySentence(notice.cause),
    ...quoted(notice.cause),
    ...stillTrue(notice.cause),
  ];

  return {
    subject: `An email about ${named} did not go out`,
    textBody: paragraphs.join('\n\n') + '\n',
  };
}

function whatWasSent(notice: FailureNotice): string {
  const table = notice.audience === 'customer' ? CUSTOMER_SENDS : INTERNAL_SENDS;
  return `${table[notice.subject.type]} (${notice.subject.label})`;
}

const CUSTOMER_SENDS = {
  quote: "The customer's copy of a quote you sent",
  order: 'The order confirmation for a customer',
} as const satisfies Record<SendSubjectType, string>;

const INTERNAL_SENDS = {
  quote: 'The alert telling production about a quote',
  order: 'The alert telling production about a purchase order',
} as const satisfies Record<SendSubjectType, string>;

function addressee(notice: FailureNotice): string {
  return notice.recipients.length === 0
    ? 'There was nobody to send it to.'
    : `It was addressed to ${notice.recipients.join(', ')}.`;
}

function whySentence(cause: NoticeCause): string {
  if (cause.kind === 'nobody-to-send-to') {
    if (cause.reason === 'no-holders') {
      return (
        'Nobody holds the role it was addressed to, so there was nobody to send it to. ' +
        'An administrator grants that role on the users screen. ' +
        'Sending it again will not help until somebody holds it.'
      );
    }
    const who = cause.unreachableHolders.join(', ');
    return (
      `The role is held, and no holder has an email address on record${
        who === '' ? '' : ` (${who})`
      }. ` + 'An administrator adds one on the users screen.'
    );
  }

  return cause.permanent
    ? 'The mail relay refused it outright, so nobody received it. ' +
        'Sending the same thing again will be refused the same way, so it is not worth retrying ' +
        'until the address is corrected.'
    : 'The mail relay could not be reached, so nothing left the building. ' +
        'Sending it again is worth doing; if it keeps failing, the relay itself needs attention.';
}

function quoted(cause: NoticeCause): string[] {
  if (cause.kind !== 'relay-refused' || cause.detail === undefined) {
    return [];
  }
  return [`The relay said: ${cause.detail}`];
}

function stillTrue(cause: NoticeCause): string[] {
  return cause.kind === 'nobody-to-send-to' ? [cause.stands] : [];
}
