// Tests the notice to a sender whose email failed: when it is sent, who is skipped, and that a notice never produces another.
import {
  InMemoryMailSink,
  InMemorySendLog,
  MailSubmissionError,
  RedirectingMailSink,
  systemClock,
} from '@erp/notifications';
import type { MailLog, MailSink, OutboundEmail } from '@erp/notifications';
import { FAILURE_NOTICE_ACTOR } from '@erp/types';
import { describe, expect, it } from 'vitest';

import {
  createFailureNotifier,
  recordUnsendableAndNotify,
  sendAndNotify,
  type SenderDirectory,
} from '../src/notifications/notify-sender-of-failure';

const ORDER = {
  type: 'order',
  id: '01a01a98-d215-76bd-ae1e-99bb52bdc29b',
  label: 'DPW-00264',
} as const;
const QUOTE = {
  type: 'quote',
  id: '01a01a98-d215-76bd-ae1e-99bb52bdc2ff',
  label: 'Q-00318',
} as const;

const EMAIL: OutboundEmail = {
  to: ['ap@acme.example.test'],
  subject: 'Your order confirmation',
  textBody: 'Attached.',
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

function directory(entries: Record<string, { email?: string }>): SenderDirectory {
  return { findByUsername: async (username) => entries[username] ?? null };
}

function harness(options: { senders?: SenderDirectory; sink?: MailSink } = {}) {
  const inner = new InMemoryMailSink(systemClock);
  const mail = options.sink ?? inner;
  const sendLog = new InMemorySendLog();
  const log = silentLog();
  const senders = options.senders ?? directory({ jsmith: { email: 'jsmith@example.test' } });
  const notifySender = createFailureNotifier({
    mail,
    sendLog,
    log,
    senders,
  });
  return { inner, mail, sendLog, log, notifySender, deps: { mail, sendLog, log, notifySender } };
}

function noticeRows(sendLog: InMemorySendLog) {
  return sendLog.rows.filter((row) => row.actor === FAILURE_NOTICE_ACTOR);
}

const ABOUT = { subject: ORDER, audience: 'customer', actor: 'jsmith' } as const;

describe('a failed send tells whoever pressed send', () => {
  it('emails the sender, naming what failed and who it was for', async () => {
    const h = harness();
    h.inner.failNextSubmissions(1);

    await expect(sendAndNotify(h.deps, EMAIL, ABOUT)).rejects.toBeInstanceOf(MailSubmissionError);

    expect(h.inner.submissions).toHaveLength(1);
    const notice = h.inner.submissions[0]?.mail;
    expect(notice?.to).toEqual(['jsmith@example.test']);
    expect(notice?.subject).toContain('did not go out');

    expect(notice?.textBody).toContain('ap@acme.example.test');

    expect(noticeRows(h.sendLog)).toHaveLength(1);
    expect(noticeRows(h.sendLog)[0]).toMatchObject({
      subject: { type: ORDER.type, id: ORDER.id },

      subjectLabel: 'DPW-00264',
      audience: 'internal',
      actor: FAILURE_NOTICE_ACTOR,
      outcome: 'accepted',
    });
  });

  it('names a permanent refusal as one not worth retrying', async () => {
    const h = harness();
    h.inner.rejectNextSubmissions(1);

    await expect(sendAndNotify(h.deps, EMAIL, ABOUT)).rejects.toBeInstanceOf(MailSubmissionError);

    const body = h.inner.submissions[0]?.mail.textBody ?? '';
    expect(body).toContain('refused it outright');
    expect(body).toContain('not worth retrying');

    expect(body).toContain('injected permanent rejection');
  });

  it('words a transient refusal differently, because trying again is the repair', async () => {
    const h = harness();
    h.inner.failNextSubmissions(1);

    await expect(sendAndNotify(h.deps, EMAIL, ABOUT)).rejects.toBeInstanceOf(MailSubmissionError);

    const body = h.inner.submissions[0]?.mail.textBody ?? '';
    expect(body).toContain('could not be reached');
    expect(body).not.toContain('not worth retrying');
  });

  it('describes an internal alert as one, not as the customer missing out', async () => {
    const h = harness();
    h.inner.failNextSubmissions(1);

    await expect(
      sendAndNotify(h.deps, EMAIL, { subject: ORDER, audience: 'internal', actor: 'jsmith' }),
    ).rejects.toBeInstanceOf(MailSubmissionError);

    const body = h.inner.submissions[0]?.mail.textBody ?? '';

    expect(body).toContain('The alert telling production about a purchase order');
  });
});

describe('who does not get a notice', () => {
  it('does not notify when the actor is system, because nobody pressed anything', async () => {
    const h = harness();
    h.inner.failNextSubmissions(1);

    await expect(
      sendAndNotify(h.deps, EMAIL, { subject: ORDER, audience: 'customer', actor: 'system' }),
    ).rejects.toBeInstanceOf(MailSubmissionError);

    expect(h.inner.submissions).toHaveLength(0);
    expect(noticeRows(h.sendLog)).toHaveLength(0);
    expect(h.log.lines).toContainEqual(
      expect.objectContaining({ event: 'failure_notice_skipped', reason: 'unattended-send' }),
    );
  });

  it('does not notify a user with no email address, and says so in the log', async () => {
    const h = harness({ senders: directory({ jsmith: {} }) });
    h.inner.failNextSubmissions(1);

    await expect(sendAndNotify(h.deps, EMAIL, ABOUT)).rejects.toBeInstanceOf(MailSubmissionError);

    expect(h.inner.submissions).toHaveLength(0);
    expect(h.log.lines).toContainEqual(
      expect.objectContaining({ event: 'failure_notice_skipped', reason: 'no-email-address' }),
    );
  });

  it('does not notify an actor the directory does not know, and says which', async () => {
    const h = harness({ senders: directory({}) });
    h.inner.failNextSubmissions(1);

    await expect(
      sendAndNotify(h.deps, EMAIL, { subject: ORDER, audience: 'customer', actor: 'departed' }),
    ).rejects.toBeInstanceOf(MailSubmissionError);

    expect(h.inner.submissions).toHaveLength(0);
    expect(h.log.lines).toContainEqual(
      expect.objectContaining({ event: 'failure_notice_skipped', reason: 'no-such-user' }),
    );
  });
});

describe('a notice cannot produce another notice', () => {
  it('logs a failed notice once and never produces another', async () => {
    const h = harness();
    h.inner.failNextSubmissions(2);

    await expect(sendAndNotify(h.deps, EMAIL, ABOUT)).rejects.toBeInstanceOf(MailSubmissionError);

    expect(h.inner.attemptedMessageIds).toHaveLength(2);
    expect(h.inner.submissions).toHaveLength(0);

    expect(noticeRows(h.sendLog)).toHaveLength(1);
    expect(noticeRows(h.sendLog)[0]).toMatchObject({
      actor: FAILURE_NOTICE_ACTOR,
      audience: 'internal',
      outcome: 'failed',
    });

    expect(h.sendLog.rows).toHaveLength(2);

    expect(h.log.lines).toContainEqual(
      expect.objectContaining({ event: 'failure_notice_failed', actor: 'jsmith' }),
    );
  });
});

describe('test mode', () => {
  it('redirects a notice like any other mail, with no special case', async () => {
    const inner = new InMemoryMailSink(systemClock);
    const redirecting = new RedirectingMailSink(inner, {
      to: 'testers@example.test',
      allow: [],
    });
    const h = harness({ sink: redirecting });
    inner.failNextSubmissions(1);

    await expect(sendAndNotify(h.deps, EMAIL, ABOUT)).rejects.toBeInstanceOf(MailSubmissionError);

    expect(inner.submissions).toHaveLength(1);
    expect(inner.submissions[0]?.mail.to).toEqual(['testers@example.test']);

    expect(noticeRows(h.sendLog)[0]).toMatchObject({
      recipients: ['jsmith@example.test'],
      redirectedTo: ['testers@example.test'],
    });
  });
});

describe('an alert that never reached the relay', () => {
  it('tells the sender what failed and that the quote itself went out', async () => {
    const h = harness();

    await recordUnsendableAndNotify(h.deps, {
      subject: QUOTE,
      actor: 'jsmith',
      reason: 'no-holders',
      unreachableHolders: [],
      stands: 'The quote itself went to the customer as normal.',
    });

    const body = h.inner.submissions[0]?.mail.textBody ?? '';
    expect(body).toContain('The quote itself went to the customer as normal.');
    expect(body).toContain('Nobody holds the role');
    expect(body).toContain('There was nobody to send it to.');

    expect(body).toContain('The alert telling production about a quote');

    expect(h.sendLog.rows).toHaveLength(2);
    expect(noticeRows(h.sendLog)).toHaveLength(1);
  });

  it('names the holders who have no address, because that is the remedy', async () => {
    const h = harness();

    await recordUnsendableAndNotify(h.deps, {
      subject: QUOTE,
      actor: 'jsmith',
      reason: 'no-addresses',
      unreachableHolders: ['zoe', 'adam'],
      stands: 'The quote itself went to the customer as normal.',
    });

    const body = h.inner.submissions[0]?.mail.textBody ?? '';
    expect(body).toContain('zoe, adam');
    expect(body).toContain('adds one on the users screen');
  });

  it('records the abandoned alert even when nobody can be notified about it', async () => {
    const h = harness({ senders: directory({}) });

    await recordUnsendableAndNotify(h.deps, {
      subject: QUOTE,
      actor: 'departed',
      reason: 'no-holders',
      unreachableHolders: [],
      stands: 'The quote itself went to the customer as normal.',
    });

    expect(h.sendLog.rows).toHaveLength(1);
    expect(h.sendLog.rows[0]).toMatchObject({ outcome: 'failed', failureReason: 'no-holders' });
    expect(h.inner.submissions).toHaveLength(0);
  });
});
