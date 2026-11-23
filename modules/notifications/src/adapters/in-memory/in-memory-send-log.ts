// In-memory `SendLog`, used by the demo and by tests. It meets the same contract as the PostgreSQL
// adapter: modules/notifications/test/contracts/send-log.contract.ts.
import { newId } from '@erp/db';
import type {
  SendAudience,
  SendKind,
  SendLogEntry,
  SendLogRecord,
  SendSubject,
  SendSubjectType,
} from '@erp/types';

import type { SendLog } from '../../ports';

export class InMemorySendLog implements SendLog {
  readonly #rows: SendLogRecord[] = [];

  async record(entry: SendLogEntry): Promise<SendLogRecord> {
    const stored: SendLogRecord = {
      id: newId(),
      messageId: entry.messageId,
      subject: { ...entry.subject },

      recipients: [...entry.recipients],
      audience: entry.audience,
      actor: entry.actor,
      submittedAt: new Date(entry.submittedAt),
      outcome: entry.outcome,
      ...(entry.failureReason === undefined ? {} : { failureReason: entry.failureReason }),

      unreachableHolders: [...(entry.unreachableHolders ?? [])],

      ...(entry.failureDetail === undefined ? {} : { failureDetail: entry.failureDetail }),
      ...(entry.failurePermanent === undefined ? {} : { failurePermanent: entry.failurePermanent }),

      ...(entry.redirectedTo === undefined ? {} : { redirectedTo: [...entry.redirectedTo] }),

      ...(entry.subjectLabel === undefined ? {} : { subjectLabel: entry.subjectLabel }),

      ...(entry.kind === undefined ? {} : { kind: entry.kind }),
    };
    this.#rows.push(stored);
    return stored;
  }

  async latestFor(
    subject: SendSubject,
    options?: { audience?: SendAudience; kind?: SendKind },
  ): Promise<SendLogRecord | undefined> {
    let latest: SendLogRecord | undefined;
    for (const row of this.#rows) {
      if (row.subject.type !== subject.type || row.subject.id !== subject.id) {
        continue;
      }
      if (options?.audience !== undefined && row.audience !== options.audience) {
        continue;
      }
      if (options?.kind !== undefined && row.kind !== options.kind) {
        continue;
      }

      if (
        latest === undefined ||
        row.submittedAt > latest.submittedAt ||
        // A tie on `submittedAt` breaks by id, as the PostgreSQL adapter's ordering does.
        (row.submittedAt.getTime() === latest.submittedAt.getTime() && row.id > latest.id)
      ) {
        latest = row;
      }
    }
    return latest;
  }

  async latestOfKindFor(
    subjectType: SendSubjectType,
    subjectIds: readonly string[],
    kind: SendKind,
  ): Promise<ReadonlyMap<string, SendLogRecord>> {
    const latest = new Map<string, SendLogRecord>();
    for (const id of new Set(subjectIds)) {
      const row = await this.latestFor({ type: subjectType, id }, { kind });
      if (row !== undefined) {
        latest.set(id, row);
      }
    }
    return latest;
  }

  async historyFor(
    subject: SendSubject,
    options?: { audience?: SendAudience },
  ): Promise<readonly SendLogRecord[]> {
    return this.#rows
      .filter(
        (row) =>
          row.subject.type === subject.type &&
          row.subject.id === subject.id &&
          (options?.audience === undefined || row.audience === options.audience),
      )

      .sort((a, b) => {
        const byTime = b.submittedAt.getTime() - a.submittedAt.getTime();
        return byTime !== 0 ? byTime : b.id.localeCompare(a.id);
      });
  }

  async failedInternalAlertsSince(since: Date): Promise<{ count: number; latest?: SendLogRecord }> {
    const matching = this.#rows.filter(
      (row) =>
        row.audience === 'internal' && row.failureReason !== undefined && row.submittedAt >= since,
    );

    let latest: SendLogRecord | undefined;
    for (const row of matching) {
      if (
        latest === undefined ||
        row.submittedAt > latest.submittedAt ||
        (row.submittedAt.getTime() === latest.submittedAt.getTime() && row.id > latest.id)
      ) {
        latest = row;
      }
    }
    return latest === undefined ? { count: matching.length } : { count: matching.length, latest };
  }

  get rows(): readonly SendLogRecord[] {
    return this.#rows;
  }
}
