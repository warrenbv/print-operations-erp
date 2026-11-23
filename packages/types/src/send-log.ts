// The send log: one record of every message the system sends, keyed to its subject by type and id, not a foreign key.
// The notifications module owns it: modules/notifications/src/ports.ts. The lists here are mirrored by CHECK
// constraints in infra/db/migrations/notifications/0000_baseline.sql.
import { z } from 'zod';

import { shortId } from './identifier';

export const SEND_SUBJECT_TYPES = ['order', 'quote'] as const;

export const sendSubjectTypeSchema = z.enum(SEND_SUBJECT_TYPES);

export type SendSubjectType = z.infer<typeof sendSubjectTypeSchema>;

export const sendSubjectSchema = z.object({
  type: sendSubjectTypeSchema,
  id: z.uuid(),
});

export type SendSubject = z.infer<typeof sendSubjectSchema>;

export const SEND_SUBJECT_LABEL_MAX = 64;

export const sendSubjectLabelSchema = z.string().trim().min(1).max(SEND_SUBJECT_LABEL_MAX);

export const labelledSendSubjectSchema = sendSubjectSchema.extend({
  label: sendSubjectLabelSchema,
});

export type LabelledSendSubject = z.infer<typeof labelledSendSubjectSchema>;

const SEND_SUBJECT_NOUNS = {
  quote: 'Quote',
  order: 'Order',
} as const satisfies Record<SendSubjectType, string>;

export function sendSubjectName(type: SendSubjectType, id: string, label?: string): string {
  if (label === undefined) {
    return `${SEND_SUBJECT_NOUNS[type]} ${shortId(id)}`;
  }
  return `${SEND_SUBJECT_NOUNS[type]} ${label}`;
}

export function orderSubjectLabel(order: { id: string; jobNumber?: string }): string {
  return order.jobNumber ?? shortId(order.id);
}

export const SEND_AUDIENCES = ['customer', 'internal'] as const;

export const sendAudienceSchema = z.enum(SEND_AUDIENCES);

export type SendAudience = z.infer<typeof sendAudienceSchema>;

export const SEND_KINDS = ['lead-time-request'] as const;

export const sendKindSchema = z.enum(SEND_KINDS);

export type SendKind = z.infer<typeof sendKindSchema>;

export const SEND_OUTCOMES = ['accepted', 'failed'] as const;

export const sendOutcomeSchema = z.enum(SEND_OUTCOMES);

export type SendOutcome = z.infer<typeof sendOutcomeSchema>;

export const SEND_FAILURE_REASONS = ['no-holders', 'no-addresses'] as const;

export const sendFailureReasonSchema = z.enum(SEND_FAILURE_REASONS);

export type SendFailureReason = z.infer<typeof sendFailureReasonSchema>;

export const SEND_FAILURE_DETAIL_MAX = 500;

// The actor recorded on the notice the system sends when a send fails.
export const FAILURE_NOTICE_ACTOR = 'system:failure-notice';

export const sendLogEntrySchema = z.object({
  messageId: z.string().trim().min(1).max(998),
  subject: sendSubjectSchema,

  audience: sendAudienceSchema,

  recipients: z.array(z.string().trim().min(1)).readonly(),

  actor: z.string().trim().min(1).max(128),

  submittedAt: z.date(),
  outcome: sendOutcomeSchema,

  failureReason: sendFailureReasonSchema.optional(),

  unreachableHolders: z.array(z.string().trim().min(1)).readonly().optional(),

  failureDetail: z.string().trim().min(1).max(SEND_FAILURE_DETAIL_MAX).optional(),

  failurePermanent: z.boolean().optional(),

  redirectedTo: z.array(z.string().trim().min(1)).readonly().optional(),

  subjectLabel: sendSubjectLabelSchema.optional(),

  kind: sendKindSchema.optional(),
});

export type SendLogEntry = z.infer<typeof sendLogEntrySchema>;

export const sendLogRecordSchema = sendLogEntrySchema.extend({
  id: z.uuid(),
  unreachableHolders: z.array(z.string().trim().min(1)).readonly(),
});

export type SendLogRecord = z.infer<typeof sendLogRecordSchema>;
