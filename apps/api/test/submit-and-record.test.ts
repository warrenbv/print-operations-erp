// Tests `submitAndRecord` in apps/api/src/notifications/submit-and-record.ts: one send log row per send, and a log failure never masking the send.
import {
  InMemoryMailSink,
  InMemorySendLog,
  MailSubmissionError,
  systemClock,
} from '@erp/notifications';
import type { MailLog, MailSink, OutboundEmail, SendLog } from '@erp/notifications';
import { describe, expect, it } from 'vitest';

import { submitAndRecord } from '../src/notifications/submit-and-record';

const EMAIL: OutboundEmail = {
  to: ['ap@acme.example.test', 'buyer@acme.example.test'],
  subject: 'Your order confirmation',
  textBody: 'Attached.',
};

const ABOUT = {
  subject: {
    type: 'order',
    id: '01a01a98-d215-76bd-ae1e-99bb52bdc29b',
    label: 'DPW-00264',
  } as const,
  audience: 'customer' as const,
  actor: 'jsmith',
};

function silentLog(): MailLog & { lines: Record<string, unknown>[] } {
  const lines: Record<string, unknown>[] = [];
  return {
    lines,
    info: (l) => lines.push(l),
    warn: (l) => lines.push(l),
    error: (l) => lines.push(l),
  };
}

function refusingSink(inner: MailSink): MailSink {
  return {
    mintMessageId: () => inner.mintMessageId(),
    submit: async () => {
      throw new MailSubmissionError('relay refused', 3);
    },
  };
}

describe('submitAndRecord', () => {
  it('records an accepted send with the id the relay was handed', async () => {
    const mail = new InMemoryMailSink(systemClock);
    const sendLog = new InMemorySendLog();

    const submission = await submitAndRecord({ mail, sendLog, log: silentLog() }, EMAIL, ABOUT);

    expect(sendLog.rows).toHaveLength(1);
    expect(sendLog.rows[0]).toMatchObject({
      messageId: submission.messageId,
      recipients: ['ap@acme.example.test', 'buyer@acme.example.test'],
      actor: 'jsmith',
      outcome: 'accepted',

      subjectLabel: 'DPW-00264',
    });
    expect(sendLog.rows[0]?.subject).toEqual({ type: 'order', id: ABOUT.subject.id });
    expect(sendLog.rows[0]?.submittedAt).toEqual(submission.acceptedByRelayAt);
  });

  it('records a failed submission and rethrows the original error', async () => {
    const sendLog = new InMemorySendLog();
    const mail = refusingSink(new InMemoryMailSink(systemClock));

    await expect(
      submitAndRecord({ mail, sendLog, log: silentLog() }, EMAIL, ABOUT),
    ).rejects.toBeInstanceOf(MailSubmissionError);

    expect(sendLog.rows).toHaveLength(1);
    expect(sendLog.rows[0]).toMatchObject({ outcome: 'failed', recipients: EMAIL.to });
  });

  it('gives the failed row a real correlation id, because the id is minted first', async () => {
    const sendLog = new InMemorySendLog();
    const mail = refusingSink(new InMemoryMailSink(systemClock));

    await expect(
      submitAndRecord({ mail, sendLog, log: silentLog() }, EMAIL, ABOUT),
    ).rejects.toThrow();

    expect(sendLog.rows[0]?.messageId).toMatch(/^<.+@.+>$/);
  });

  it('writes one row per logical send, not one per retry attempt', async () => {
    const sendLog = new InMemorySendLog();
    let attempts = 0;
    const mail: MailSink = {
      mintMessageId: () => '<one@org.example.test>',
      submit: async () => {
        attempts += 1;
        throw new MailSubmissionError('refused', attempts);
      },
    };

    await expect(
      submitAndRecord({ mail, sendLog, log: silentLog() }, EMAIL, ABOUT),
    ).rejects.toThrow();

    expect(sendLog.rows).toHaveLength(1);
  });

  it('records what the relay said and whether retrying could work', async () => {
    const sendLog = new InMemorySendLog();
    const mail: MailSink = {
      mintMessageId: () => '<one@org.example.test>',
      submit: async () => {
        throw new MailSubmissionError(
          'mail submission failed after 3 attempts',
          3,
          new Error('connect ECONNREFUSED 192.0.2.5:25'),
        );
      },
    };

    await expect(
      submitAndRecord({ mail, sendLog, log: silentLog() }, EMAIL, ABOUT),
    ).rejects.toThrow();

    expect(sendLog.rows[0]).toMatchObject({
      outcome: 'failed',
      failureDetail: 'mail submission failed after 3 attempts: connect ECONNREFUSED 192.0.2.5:25',
      failurePermanent: false,
    });
  });

  it('marks a permanent rejection so nothing offers a pointless retry', async () => {
    const sendLog = new InMemorySendLog();
    const mail: MailSink = {
      mintMessageId: () => '<one@org.example.test>',
      submit: async () => {
        throw new MailSubmissionError(
          'mail submission was permanently rejected on attempt 1',
          1,
          new Error('550 5.1.1 unknown user'),
          true,
        );
      },
    };

    await expect(
      submitAndRecord({ mail, sendLog, log: silentLog() }, EMAIL, ABOUT),
    ).rejects.toThrow();

    expect(sendLog.rows[0]?.failurePermanent).toBe(true);
    expect(sendLog.rows[0]?.failureDetail).toContain('550 5.1.1 unknown user');
  });

  it('leaves the relay fields off an accepted row', async () => {
    const sendLog = new InMemorySendLog();

    await submitAndRecord(
      { mail: new InMemoryMailSink(systemClock), sendLog, log: silentLog() },
      EMAIL,
      ABOUT,
    );

    expect(sendLog.rows[0]).not.toHaveProperty('failureDetail');
    expect(sendLog.rows[0]).not.toHaveProperty('failurePermanent');
  });

  describe('when the log itself cannot be written', () => {
    const brokenLog = (): SendLog => ({
      record: async () => {
        throw new Error('send_log unreachable');
      },
      latestFor: async () => undefined,

      latestOfKindFor: async () => new Map(),
      historyFor: async () => [],
      failedInternalAlertsSince: async () => ({ count: 0 }),
    });

    it('still reports the send as succeeded, because the mail has already gone', async () => {
      const mail = new InMemoryMailSink(systemClock);
      const log = silentLog();

      const submission = await submitAndRecord({ mail, sendLog: brokenLog(), log }, EMAIL, ABOUT);

      expect(submission.messageId).toBeTruthy();
      expect(mail.submissions).toHaveLength(1);

      expect(log.lines).toContainEqual(
        expect.objectContaining({ event: 'send_log_write_failed', outcome: 'accepted' }),
      );
    });

    it('does not let a log failure mask why the mail failed', async () => {
      const mail = refusingSink(new InMemoryMailSink(systemClock));
      const log = silentLog();

      await expect(
        submitAndRecord({ mail, sendLog: brokenLog(), log }, EMAIL, ABOUT),
      ).rejects.toBeInstanceOf(MailSubmissionError);

      expect(log.lines).toContainEqual(
        expect.objectContaining({ event: 'send_log_write_failed', outcome: 'failed' }),
      );
    });
  });
});
