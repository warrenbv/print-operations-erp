// The notifications module's own PostgreSQL schema: the send log. The migration is generated from
// this file into infra/db/migrations/notifications. The CHECK constraints that hold the text columns to
// the values in packages/types/src/send-log.ts are hand-written at the end of that baseline.
import { sql } from 'drizzle-orm';
import { boolean, index, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const notificationsSchema = pgSchema('notifications');

export const sendLog = notificationsSchema.table(
  'send_log',
  {
    id: uuid('id').primaryKey(),

    messageId: text('message_id').notNull(),

    // The quote or order the send was about, held without a foreign key because those tables live in
    // other modules' schemas: docs/decisions/010-orm-spike.md.
    subjectType: text('subject_type').notNull(),
    subjectId: uuid('subject_id').notNull(),

    // The addresses the sender meant. Where a test-mode redirect sent it instead is `redirectedTo`.
    recipients: text('recipients').array().notNull(),

    actor: text('actor').notNull(),

    submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull(),

    outcome: text('outcome').notNull(),

    audience: text('audience').notNull(),

    // A failure is one of two kinds. `failureReason` and `unreachableHolders` record that nobody could
    // receive an internal alert. `failureDetail` and `failurePermanent` record a relay failure. The
    // baseline's `send_log_failure_kinds_exclusive_check` keeps them apart.
    failureReason: text('failure_reason'),

    unreachableHolders: text('unreachable_holders').array().notNull().default([]),

    failureDetail: text('failure_detail'),

    failurePermanent: boolean('failure_permanent'),

    redirectedTo: text('redirected_to').array(),

    subjectLabel: text('subject_label'),

    kind: text('kind'),
  },
  (table) => [
    index('send_log_message_id_idx').on(table.messageId),

    index('send_log_subject_idx').on(table.subjectType, table.subjectId, table.submittedAt),

    index('send_log_subject_audience_idx').on(
      table.subjectType,
      table.subjectId,
      table.audience,
      table.submittedAt,
    ),

    index('send_log_subject_kind_idx')
      .on(table.subjectType, table.subjectId, table.kind, table.submittedAt)
      .where(sql`${table.kind} IS NOT NULL`),
    index('send_log_failures_idx')
      .on(table.submittedAt)
      .where(sql`${table.outcome} = 'failed'`),
  ],
);
