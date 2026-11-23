// PostgreSQL `SendLog`. It meets the same contract as the in-memory adapter:
// modules/notifications/test/contracts/send-log.contract.ts.
import { newId } from '@erp/db';
import type {
  SendAudience,
  SendKind,
  SendLogEntry,
  SendLogRecord,
  SendSubject,
  SendSubjectType,
} from '@erp/types';
import { and, asc, desc, eq, gte, inArray, isNotNull, sql } from 'drizzle-orm';

import type { NotificationsDb } from '../../data/notifications-db';
import { sendLog } from '../../data/schema';
import type { SendLog } from '../../ports';

type Row = typeof sendLog.$inferSelect;

function toRecord(row: Row): SendLogRecord {
  return {
    id: row.id,
    messageId: row.messageId,
    subject: {
      type: row.subjectType as SendLogRecord['subject']['type'],
      id: row.subjectId,
    },
    recipients: row.recipients,
    audience: row.audience as SendLogRecord['audience'],
    actor: row.actor,
    submittedAt: row.submittedAt,
    outcome: row.outcome as SendLogRecord['outcome'],

    ...(row.failureReason === null
      ? {}
      : { failureReason: row.failureReason as SendLogRecord['failureReason'] }),
    unreachableHolders: row.unreachableHolders,

    ...(row.failureDetail === null ? {} : { failureDetail: row.failureDetail }),
    ...(row.failurePermanent === null ? {} : { failurePermanent: row.failurePermanent }),

    ...(row.redirectedTo === null ? {} : { redirectedTo: row.redirectedTo }),

    ...(row.subjectLabel === null ? {} : { subjectLabel: row.subjectLabel }),

    ...(row.kind === null ? {} : { kind: row.kind as SendKind }),
  };
}

export class DrizzleSendLog implements SendLog {
  readonly #db: NotificationsDb;

  constructor(db: NotificationsDb) {
    this.#db = db;
  }

  async record(entry: SendLogEntry): Promise<SendLogRecord> {
    const [row] = await this.#db
      .insert(sendLog)
      .values({
        id: newId(),
        messageId: entry.messageId,
        subjectType: entry.subject.type,
        subjectId: entry.subject.id,

        recipients: [...entry.recipients],
        audience: entry.audience,
        actor: entry.actor,
        submittedAt: entry.submittedAt,
        outcome: entry.outcome,

        failureReason: entry.failureReason ?? null,
        unreachableHolders: [...(entry.unreachableHolders ?? [])],

        failureDetail: entry.failureDetail ?? null,
        failurePermanent: entry.failurePermanent ?? null,

        redirectedTo: entry.redirectedTo === undefined ? null : [...entry.redirectedTo],

        subjectLabel: entry.subjectLabel ?? null,

        kind: entry.kind ?? null,
      })
      .returning();

    if (row === undefined) {
      throw new Error('send log insert returned no row');
    }
    return toRecord(row);
  }

  async latestFor(
    subject: SendSubject,
    options?: { audience?: SendAudience; kind?: SendKind },
  ): Promise<SendLogRecord | undefined> {
    const [row] = await this.#db
      .select()
      .from(sendLog)
      .where(
        and(
          eq(sendLog.subjectType, subject.type),
          eq(sendLog.subjectId, subject.id),

          ...(options?.audience === undefined ? [] : [eq(sendLog.audience, options.audience)]),

          ...(options?.kind === undefined ? [] : [eq(sendLog.kind, options.kind)]),
        ),
      )

      .orderBy(desc(sendLog.submittedAt), desc(sendLog.id))
      .limit(1);

    return row === undefined ? undefined : toRecord(row);
  }

  async latestOfKindFor(
    subjectType: SendSubjectType,
    subjectIds: readonly string[],
    kind: SendKind,
  ): Promise<ReadonlyMap<string, SendLogRecord>> {
    if (subjectIds.length === 0) {
      return new Map();
    }

    const rows = await this.#db
      // DISTINCT ON keeps the newest row per subject in one query. Its ORDER BY must lead with the
      // distinct column.
      .selectDistinctOn([sendLog.subjectId])
      .from(sendLog)
      .where(
        and(
          eq(sendLog.subjectType, subjectType),
          inArray(sendLog.subjectId, [...new Set(subjectIds)]),
          eq(sendLog.kind, kind),
        ),
      )
      .orderBy(asc(sendLog.subjectId), desc(sendLog.submittedAt), desc(sendLog.id));
    return new Map(rows.map((row) => [row.subjectId, toRecord(row)]));
  }

  async historyFor(
    subject: SendSubject,
    options?: { audience?: SendAudience },
  ): Promise<readonly SendLogRecord[]> {
    const rows = await this.#db
      .select()
      .from(sendLog)
      .where(
        and(
          eq(sendLog.subjectType, subject.type),
          eq(sendLog.subjectId, subject.id),
          ...(options?.audience === undefined ? [] : [eq(sendLog.audience, options.audience)]),
        ),
      )

      .orderBy(desc(sendLog.submittedAt), desc(sendLog.id));

    return rows.map(toRecord);
  }

  async failedInternalAlertsSince(since: Date): Promise<{ count: number; latest?: SendLogRecord }> {
    const where = and(
      eq(sendLog.audience, 'internal'),
      isNotNull(sendLog.failureReason),
      gte(sendLog.submittedAt, since),
    );

    const [counted] = await this.#db
      .select({ count: sql<number>`count(*)::int` })
      .from(sendLog)
      .where(where);

    const [row] = await this.#db
      .select()
      .from(sendLog)
      .where(where)

      .orderBy(desc(sendLog.submittedAt), desc(sendLog.id))
      .limit(1);

    const count = counted?.count ?? 0;
    return row === undefined ? { count } : { count, latest: toRecord(row) };
  }
}
