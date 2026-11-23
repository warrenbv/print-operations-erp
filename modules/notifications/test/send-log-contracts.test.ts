// Runs the send-log contract against the in-memory adapter, and against PostgreSQL when
// `DATABASE_URL` is set (`pnpm test:db`). Also checks the baseline's CHECK constraints.
import { resolve } from 'node:path';

import { moduleTestDatabase, newId } from '@erp/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DrizzleSendLog } from '../src/adapters/drizzle/drizzle-send-log';
import { InMemorySendLog } from '../src/adapters/in-memory/in-memory-send-log';
import { createNotificationsDb } from '../src/data/notifications-db';
import type { SendLog } from '../src/ports';
import { sendLogContract } from './contracts/send-log.contract';

const db = moduleTestDatabase({
  moduleName: 'notifications',
  migrationsFolder: resolve(__dirname, '../../../infra/db/migrations/notifications'),
  isolationKey: 'contract',
});

const describeDb = db.enabled ? describe : describe.skip;

describe('InMemorySendLog', () => {
  sendLogContract(async (): Promise<SendLog> => new InMemorySendLog());
});

describeDb('DrizzleSendLog', () => {
  beforeAll(async () => {
    await db.setup();
  }, 180_000);

  afterAll(async () => {
    await db.teardown();
  });

  sendLogContract(async (): Promise<SendLog> => {
    await db.truncate(['notifications.send_log']);
    return new DrizzleSendLog(createNotificationsDb(db.pool));
  });

  it('refuses a blank subject label, and accepts none at all', async () => {
    await db.truncate(['notifications.send_log']);
    const log = new DrizzleSendLog(createNotificationsDb(db.pool));
    const row = {
      messageId: `<${newId()}@org.example.test>`,
      subject: { type: 'quote', id: newId() },
      audience: 'customer',
      recipients: ['ap@acme.example.test'],
      actor: 'jsmith',
      submittedAt: new Date('2026-09-28T17:00:00.000Z'),
      outcome: 'accepted',
    } as const;

    const refusal = await log.record({ ...row, subjectLabel: '  ' }).then(
      () => undefined,
      (cause: unknown) => cause,
    );
    const said = [refusal, (refusal as { cause?: unknown } | undefined)?.cause]
      .map((e) => (e instanceof Error ? e.message : ''))
      .join(' ');
    expect(said).toMatch(/send_log_subject_label_check/);

    await expect(log.record(row)).resolves.not.toHaveProperty('subjectLabel');
  });

  it('accepts only an order or a quote as the subject of a send', async () => {
    await db.truncate(['notifications.send_log']);
    const insert = (subjectType: string) =>
      db.pool.query(
        `INSERT INTO notifications.send_log
           (id, message_id, subject_type, subject_id, recipients, actor, submitted_at,
            outcome, audience)
         VALUES ($1, $2, $3, $4, ARRAY['ap@acme.example.test'], 'jsmith', now(),
                 'accepted', 'customer')`,
        [newId(), `<${newId()}@org.example.test>`, subjectType, newId()],
      );

    await insert('order');
    await insert('quote');
    await expect(insert('invoice')).rejects.toMatchObject({
      code: '23514',
      constraint: 'send_log_subject_type_check',
    });
  });
});
