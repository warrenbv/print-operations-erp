// The contract every `SendLog` adapter meets, run by modules/notifications/test/send-log-contracts.test.ts
// against the in-memory and the PostgreSQL adapter. It covers append-only recording, audience and kind
// filters, failure reasons, and newest-first ordering with an id tiebreak. A failure means the two
// adapters disagree, which callers would see only in one storage mode: docs/process/definition-of-done.md.
import { newId } from '@erp/db';
import { SEND_SUBJECT_TYPES, type SendLogEntry } from '@erp/types';
import { describe, expect, it } from 'vitest';

import type { SendLog } from '../../src/ports';

export function sendLogContract(makeLog: () => Promise<SendLog>): void {
  const SUBMITTED = new Date('2026-08-19T17:00:00.000Z');

  const entry = (over: Partial<SendLogEntry> = {}): SendLogEntry => ({
    messageId: `<${newId()}@org.example.test>`,
    subject: { type: 'order', id: newId() },
    audience: 'customer',
    recipients: ['ap@acme.example.test'],
    actor: 'jsmith',
    submittedAt: SUBMITTED,
    outcome: 'accepted',
    ...over,
  });

  describe('record', () => {
    it('returns the row with an id of its own and every field intact', async () => {
      const log = await makeLog();
      const input = entry();

      const stored = await log.record(input);

      expect(stored).toMatchObject({
        messageId: input.messageId,
        subject: input.subject,
        recipients: ['ap@acme.example.test'],
        actor: 'jsmith',
        outcome: 'accepted',
      });
      expect(stored.submittedAt.toISOString()).toBe(SUBMITTED.toISOString());

      expect(stored.id).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('records a failed submission, so an exhausted retry leaves a trace', async () => {
      const log = await makeLog();

      const stored = await log.record(entry({ outcome: 'failed' }));

      expect(stored.outcome).toBe('failed');
    });

    it('keeps several recipients, in order', async () => {
      const log = await makeLog();
      const subject = { type: 'quote', id: newId() } as const;

      await log.record(
        entry({ subject, recipients: ['ap@acme.example.test', 'buyer@acme.example.test'] }),
      );

      const found = await log.latestFor(subject);
      expect(found?.recipients).toEqual(['ap@acme.example.test', 'buyer@acme.example.test']);
    });

    it('keeps where a redirected send really went, and leaves it absent otherwise', async () => {
      const log = await makeLog();
      const subject = { type: 'quote', id: newId() } as const;

      await log.record(entry({ subject }));
      expect(await log.latestFor(subject)).not.toHaveProperty('redirectedTo');

      await log.record(
        entry({
          subject,
          submittedAt: new Date(SUBMITTED.getTime() + 1_000),
          recipients: ['ap@acme.example.test'],
          redirectedTo: ['erp-test@org.example.test'],
        }),
      );
      const redirected = await log.latestFor(subject);

      expect(redirected?.recipients).toEqual(['ap@acme.example.test']);
      expect(redirected?.redirectedTo).toEqual(['erp-test@org.example.test']);
    });

    it('keeps what a person calls the subject, and leaves it absent otherwise', async () => {
      const log = await makeLog();
      const subject = { type: 'quote', id: newId() } as const;

      await log.record(entry({ subject }));
      expect(await log.latestFor(subject)).not.toHaveProperty('subjectLabel');

      await log.record(
        entry({
          subject,
          submittedAt: new Date(SUBMITTED.getTime() + 1_000),
          subjectLabel: 'Q-00318',
        }),
      );
      expect((await log.latestFor(subject))?.subjectLabel).toBe('Q-00318');
    });

    it('carries the label on a failure', async () => {
      const log = await makeLog();
      const subject = { type: 'order', id: newId() } as const;
      await log.record(
        entry({
          subject,
          outcome: 'failed',
          failureDetail: '550 unknown user',
          subjectLabel: 'DPW-00264',
        }),
      );

      const [row] = await log.historyFor(subject);

      expect(row?.subjectLabel).toBe('DPW-00264');
    });

    it('appends on a resend rather than replacing — both rows survive', async () => {
      const log = await makeLog();
      const subject = { type: 'quote', id: newId() } as const;
      const first = await log.record(
        entry({ subject, messageId: '<first@org.example.test>', submittedAt: SUBMITTED }),
      );
      const second = await log.record(
        entry({
          subject,
          messageId: '<second@org.example.test>',
          submittedAt: new Date(SUBMITTED.getTime() + 60_000),
        }),
      );

      expect(second.id).not.toBe(first.id);

      expect(first.messageId).toBe('<first@org.example.test>');
      expect((await log.latestFor(subject))?.messageId).toBe('<second@org.example.test>');
    });

    it('accepts every subject type', async () => {
      const log = await makeLog();

      for (const type of SEND_SUBJECT_TYPES) {
        const subject = { type, id: newId() } as const;

        await log.record(entry({ subject, messageId: `<${type}@org.example.test>` }));

        expect((await log.latestFor(subject))?.messageId).toBe(`<${type}@org.example.test>`);
      }
    });
  });

  describe('latestFor and the audience', () => {
    async function customerThenAlert(log: SendLog, subject: SendLogEntry['subject']) {
      await log.record(
        entry({
          subject,
          audience: 'customer',
          messageId: '<to-customer@org.example.test>',
          recipients: ['ap@acme.example.test'],
          submittedAt: SUBMITTED,
        }),
      );
      await log.record(
        entry({
          subject,
          audience: 'internal',
          messageId: '<to-pm@org.example.test>',
          recipients: ['pm@org.example.test'],
          submittedAt: new Date(SUBMITTED.getTime() + 40),
        }),
      );
    }

    it('answers the customer send when asked for one', async () => {
      const log = await makeLog();
      const subject = { type: 'quote', id: newId() } as const;
      await customerThenAlert(log, subject);

      const found = await log.latestFor(subject, { audience: 'customer' });

      expect(found?.messageId).toBe('<to-customer@org.example.test>');
      expect(found?.recipients).toEqual(['ap@acme.example.test']);
    });

    it('answers the internal alert when asked for one', async () => {
      const log = await makeLog();
      const subject = { type: 'quote', id: newId() } as const;
      await customerThenAlert(log, subject);

      expect((await log.latestFor(subject, { audience: 'internal' }))?.messageId).toBe(
        '<to-pm@org.example.test>',
      );
    });

    it('unfiltered still answers "was anything sent about this at all"', async () => {
      const log = await makeLog();
      const subject = { type: 'quote', id: newId() } as const;
      await customerThenAlert(log, subject);

      expect((await log.latestFor(subject))?.messageId).toBe('<to-pm@org.example.test>');
    });

    it('does not let a FAILED internal alert masquerade as the customer send', async () => {
      const log = await makeLog();
      const subject = { type: 'quote', id: newId() } as const;
      await log.record(
        entry({ subject, audience: 'customer', messageId: '<sent@org.example.test>' }),
      );
      await log.record(
        entry({
          subject,
          audience: 'internal',
          outcome: 'failed',
          messageId: '<alert-failed@org.example.test>',
          submittedAt: new Date(SUBMITTED.getTime() + 615),
        }),
      );

      const found = await log.latestFor(subject, { audience: 'customer' });
      expect(found).toMatchObject({ messageId: '<sent@org.example.test>', outcome: 'accepted' });
    });

    it('is undefined when the subject has no send of that audience', async () => {
      const log = await makeLog();
      const subject = { type: 'order', id: newId() } as const;
      await log.record(entry({ subject, audience: 'internal' }));

      expect(await log.latestFor(subject, { audience: 'customer' })).toBeUndefined();
    });

    it('breaks a same-millisecond tie by id, identically in both adapters', async () => {
      const log = await makeLog();
      const subject = { type: 'order', id: newId() } as const;
      const first = await log.record(
        entry({ subject, messageId: '<first@org.example.test>', submittedAt: SUBMITTED }),
      );
      const second = await log.record(
        entry({ subject, messageId: '<second@org.example.test>', submittedAt: SUBMITTED }),
      );

      expect(second.id > first.id).toBe(true);
      expect((await log.latestFor(subject))?.messageId).toBe('<second@org.example.test>');
    });
  });

  describe('latestFor', () => {
    it('is undefined when nothing was ever sent about the subject', async () => {
      const log = await makeLog();

      expect(await log.latestFor({ type: 'order', id: newId() })).toBeUndefined();
    });

    it('answers by submittedAt, not by insertion order', async () => {
      const log = await makeLog();
      const subject = { type: 'order', id: newId() } as const;

      await log.record(
        entry({
          subject,
          messageId: '<newer@org.example.test>',
          submittedAt: new Date(SUBMITTED.getTime() + 60_000),
        }),
      );
      await log.record(
        entry({ subject, messageId: '<older@org.example.test>', submittedAt: SUBMITTED }),
      );

      expect((await log.latestFor(subject))?.messageId).toBe('<newer@org.example.test>');
    });

    it('does not confuse two subjects that share an id across types', async () => {
      const log = await makeLog();

      const id = newId();

      await log.record(
        entry({ subject: { type: 'order', id }, messageId: '<order@org.example.test>' }),
      );
      await log.record(
        entry({ subject: { type: 'quote', id }, messageId: '<quote@org.example.test>' }),
      );

      expect((await log.latestFor({ type: 'order', id }))?.messageId).toBe(
        '<order@org.example.test>',
      );
      expect((await log.latestFor({ type: 'quote', id }))?.messageId).toBe(
        '<quote@org.example.test>',
      );
    });
  });
  describe('failure reasons and unreachable holders', () => {
    it('records why an alert never reached the relay, and who was skipped', async () => {
      const log = await makeLog();

      const stored = await log.record(
        entry({
          audience: 'internal',
          outcome: 'failed',

          recipients: [],
          failureReason: 'no-addresses',
          unreachableHolders: ['dev-pm', 'jsmith'],
        }),
      );

      expect(stored.failureReason).toBe('no-addresses');
      expect(stored.unreachableHolders).toEqual(['dev-pm', 'jsmith']);
      expect(stored.recipients).toEqual([]);
    });

    it('leaves the reason absent on an ordinary row, and the holders empty', async () => {
      const log = await makeLog();

      const stored = await log.record(entry({ outcome: 'failed' }));

      expect(stored.failureReason).toBeUndefined();
      expect(stored.unreachableHolders).toEqual([]);
    });

    it('counts internal alerts that failed for a reason, inside the window', async () => {
      const log = await makeLog();
      const since = new Date(SUBMITTED.getTime() - 60_000);

      await log.record(
        entry({ audience: 'internal', outcome: 'failed', failureReason: 'no-holders' }),
      );
      await log.record(
        entry({
          audience: 'internal',
          outcome: 'failed',
          failureReason: 'no-addresses',
          messageId: '<latest@org.example.test>',
          submittedAt: new Date(SUBMITTED.getTime() + 1_000),
        }),
      );

      const { count, latest } = await log.failedInternalAlertsSince(since);

      expect(count).toBe(2);
      expect(latest?.messageId).toBe('<latest@org.example.test>');
    });

    it('leaves out a relay failure, a customer send and anything before the window', async () => {
      const log = await makeLog();
      const since = new Date(SUBMITTED.getTime() - 60_000);

      await log.record(entry({ audience: 'internal', outcome: 'failed' }));

      await log.record(
        entry({ audience: 'customer', outcome: 'failed', failureReason: 'no-holders' }),
      );

      await log.record(
        entry({
          audience: 'internal',
          outcome: 'failed',
          failureReason: 'no-holders',
          submittedAt: new Date(since.getTime() - 1_000),
        }),
      );

      expect(await log.failedInternalAlertsSince(since)).toEqual({ count: 0 });
    });

    it('still reports a failure that a later SUCCESSFUL alert followed', async () => {
      const log = await makeLog();
      const since = new Date(SUBMITTED.getTime() - 60_000);

      await log.record(
        entry({ audience: 'internal', outcome: 'failed', failureReason: 'no-addresses' }),
      );
      await log.record(
        entry({
          audience: 'internal',
          outcome: 'accepted',
          submittedAt: new Date(SUBMITTED.getTime() + 5_000),
        }),
      );

      expect((await log.failedInternalAlertsSince(since)).count).toBe(1);
    });
  });

  describe('the kind of an alert', () => {
    async function askedThenSent(log: SendLog, subject: SendLogEntry['subject']) {
      await log.record(
        entry({
          subject,
          audience: 'internal',
          kind: 'lead-time-request',
          messageId: '<asked@org.example.test>',
          submittedAt: SUBMITTED,
        }),
      );
      await log.record(
        entry({
          subject,
          audience: 'internal',
          messageId: '<sent-alert@org.example.test>',
          submittedAt: new Date(SUBMITTED.getTime() + 40),
        }),
      );
    }

    it('records the kind and reads it back, absent when none was named', async () => {
      const log = await makeLog();
      const kinded = await log.record(entry({ kind: 'lead-time-request' }));
      const plain = await log.record(entry());

      expect(kinded.kind).toBe('lead-time-request');
      expect(plain).not.toHaveProperty('kind');
    });

    it('latestFor with a kind answers that alert, not the later one', async () => {
      const log = await makeLog();
      const subject = { type: 'quote', id: newId() } as const;
      await askedThenSent(log, subject);

      expect((await log.latestFor(subject, { kind: 'lead-time-request' }))?.messageId).toBe(
        '<asked@org.example.test>',
      );
      expect((await log.latestFor(subject, { audience: 'internal' }))?.messageId).toBe(
        '<sent-alert@org.example.test>',
      );
    });

    it('latestFor with a kind is undefined when no row of that kind exists', async () => {
      const log = await makeLog();
      const subject = { type: 'quote', id: newId() } as const;
      await log.record(entry({ subject, audience: 'internal' }));

      expect(await log.latestFor(subject, { kind: 'lead-time-request' })).toBeUndefined();
    });

    it('latestOfKindFor answers the newest row of the kind per subject, in one read', async () => {
      const log = await makeLog();
      const first = { type: 'quote', id: newId() } as const;
      const second = { type: 'quote', id: newId() } as const;
      const none = { type: 'quote', id: newId() } as const;
      await askedThenSent(log, first);
      await log.record(entry({ subject: second, audience: 'internal', kind: 'lead-time-request' }));
      const newer = await log.record(
        entry({
          subject: second,
          audience: 'internal',
          kind: 'lead-time-request',
          outcome: 'failed',
          submittedAt: new Date(SUBMITTED.getTime() + 1000),
        }),
      );
      await log.record(entry({ subject: none, audience: 'internal' }));

      const found = await log.latestOfKindFor(
        'quote',
        [first.id, second.id, none.id],
        'lead-time-request',
      );

      expect(found.get(first.id)?.messageId).toBe('<asked@org.example.test>');
      expect(found.get(second.id)?.id).toBe(newer.id);
      expect(found.has(none.id)).toBe(false);
      expect(await log.latestOfKindFor('quote', [], 'lead-time-request')).toEqual(new Map());
    });
  });

  describe('historyFor', () => {
    it('is empty when nothing was ever sent about the subject', async () => {
      const log = await makeLog();

      expect(await log.historyFor({ type: 'quote', id: newId() })).toEqual([]);
    });

    it('returns every attempt, newest first', async () => {
      const log = await makeLog();
      const subject = { type: 'quote', id: newId() } as const;

      for (const [offset, messageId] of [
        [0, '<first@org.example.test>'],
        [60_000, '<second@org.example.test>'],
        [120_000, '<third@org.example.test>'],
      ] as const) {
        await log.record(
          entry({ subject, messageId, submittedAt: new Date(SUBMITTED.getTime() + offset) }),
        );
      }

      expect((await log.historyFor(subject)).map((row) => row.messageId)).toEqual([
        '<third@org.example.test>',
        '<second@org.example.test>',
        '<first@org.example.test>',
      ]);
    });

    it('keeps a refused attempt that a later successful one followed', async () => {
      const log = await makeLog();
      const subject = { type: 'quote', id: newId() } as const;
      await log.record(
        entry({
          subject,
          outcome: 'failed',
          messageId: '<refused@org.example.test>',
          submittedAt: SUBMITTED,
        }),
      );
      await log.record(
        entry({
          subject,
          outcome: 'accepted',
          messageId: '<retry@org.example.test>',
          submittedAt: new Date(SUBMITTED.getTime() + 60_000),
        }),
      );

      const history = await log.historyFor(subject);

      expect(history.map((row) => [row.messageId, row.outcome])).toEqual([
        ['<retry@org.example.test>', 'accepted'],
        ['<refused@org.example.test>', 'failed'],
      ]);

      expect((await log.latestFor(subject))?.messageId).toBe('<retry@org.example.test>');
    });

    it('filters by audience, so the customer copies can be read without the alerts', async () => {
      const log = await makeLog();
      const subject = { type: 'quote', id: newId() } as const;
      await log.record(
        entry({ subject, audience: 'customer', messageId: '<cust@x.example.test>' }),
      );
      await log.record(
        entry({
          subject,
          audience: 'internal',
          messageId: '<alert@x.example.test>',
          submittedAt: new Date(SUBMITTED.getTime() + 1_000),
        }),
      );

      expect(
        (await log.historyFor(subject, { audience: 'customer' })).map((r) => r.messageId),
      ).toEqual(['<cust@x.example.test>']);
      expect(
        (await log.historyFor(subject, { audience: 'internal' })).map((r) => r.messageId),
      ).toEqual(['<alert@x.example.test>']);

      expect(await log.historyFor(subject)).toHaveLength(2);
    });

    it('breaks a same-millisecond tie by id, and leads with what latestFor answers', async () => {
      const log = await makeLog();
      const subject = { type: 'quote', id: newId() } as const;
      await log.record(
        entry({ subject, messageId: '<first@x.example.test>', submittedAt: SUBMITTED }),
      );
      await log.record(
        entry({ subject, messageId: '<second@x.example.test>', submittedAt: SUBMITTED }),
      );

      const history = await log.historyFor(subject);

      expect(history[0]?.messageId).toBe('<second@x.example.test>');
      expect(history[0]?.messageId).toBe((await log.latestFor(subject))?.messageId);
    });

    it('does not confuse two subjects that share an id across types', async () => {
      const log = await makeLog();
      const id = newId();
      await log.record(
        entry({ subject: { type: 'order', id }, messageId: '<order@x.example.test>' }),
      );
      await log.record(
        entry({ subject: { type: 'quote', id }, messageId: '<quote@x.example.test>' }),
      );

      expect((await log.historyFor({ type: 'quote', id })).map((r) => r.messageId)).toEqual([
        '<quote@x.example.test>',
      ]);
    });

    it('carries the failure reason and the unreachable holders through', async () => {
      const log = await makeLog();
      const subject = { type: 'quote', id: newId() } as const;
      await log.record(
        entry({
          subject,
          audience: 'internal',
          outcome: 'failed',
          failureReason: 'no-addresses',
          unreachableHolders: ['demo-production'],
        }),
      );

      expect(await log.historyFor(subject)).toMatchObject([
        {
          outcome: 'failed',
          failureReason: 'no-addresses',
          unreachableHolders: ['demo-production'],
        },
      ]);
    });
  });
}
