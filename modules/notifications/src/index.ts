// Public surface of the notifications module, wired by apps/api/src/notifications/notifications.factory.ts.
export {
  MailSubmissionError,
  type Clock,
  type MailAttachment,
  type MailSink,
  type MailSubmission,
  type OutboundEmail,
  type SendLog,
} from './ports';

export { DrizzleSendLog } from './adapters/drizzle/drizzle-send-log';
export { InMemorySendLog } from './adapters/in-memory/in-memory-send-log';
export { createNotificationsDb, type NotificationsDb } from './data/notifications-db';

export { composeMessage, newMessageId, type SenderIdentity } from './message';

export {
  DEFAULT_RETRY_POLICY,
  RetryingMailSink,
  consoleMailLog,
  type MailLog,
  type RetryPolicy,
} from './retrying-mail-sink';

export {
  RedirectingMailSink,
  planRedirect,
  redirectRecipients,
  type MailRedirect,
  type RedirectPlan,
  type RedirectedRecipients,
} from './redirect';

export {
  IMPLICIT_TLS_PORT,
  SMTP_TIMEOUTS,
  SmtpMailSink,
  isPermanentRejection,
  smtpTlsMode,
  smtpTransportOptions,
  type SmtpMailSinkConfig,
  type SmtpTlsMode,
} from './adapters/smtp/smtp-mail-sink';
export { ConsoleMailSink } from './adapters/console-mail-sink';
export {
  InMemoryMailSink,
  type RecordedSubmission,
} from './adapters/in-memory/in-memory-mail-sink';

import type { Clock } from './ports';

export const systemClock: Clock = { now: () => new Date() };
