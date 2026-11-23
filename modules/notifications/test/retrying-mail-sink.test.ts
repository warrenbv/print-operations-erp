// The retrying sink: backoff, one correlation id per send, and no retry after a permanent rejection.
import { describe, expect, it } from 'vitest';

import { InMemoryMailSink } from '../src/adapters/in-memory/in-memory-mail-sink';
import { MailSubmissionError, type Clock, type OutboundEmail } from '../src/ports';
import { RetryingMailSink, type MailLog } from '../src/retrying-mail-sink';

const FIXED_NOW = new Date('2026-08-14T12:00:00Z');
const clock: Clock = { now: () => FIXED_NOW };

const MAIL: OutboundEmail = {
  to: ['customer@example.com'],
  subject: 'Quote Q-88',
  textBody: 'Attached.',
};

function harness(failures: number, attempts = 3, delaysMs: number[] = [10, 20]) {
  const lines: { level: string; line: Record<string, unknown> }[] = [];
  const log: MailLog = {
    info: (line) => lines.push({ level: 'info', line }),
    warn: (line) => lines.push({ level: 'warn', line }),
    error: (line) => lines.push({ level: 'error', line }),
  };
  const slept: number[] = [];
  const inner = new InMemoryMailSink(clock);
  inner.failNextSubmissions(failures);
  const sink = new RetryingMailSink(inner, log, { attempts, delaysMs }, async (ms) => {
    slept.push(ms);
  });
  return { sink, inner, lines, slept };
}

describe('RetryingMailSink logs and retries failures', () => {
  it('submits once and logs the correlation id on the happy path', async () => {
    const { sink, inner, lines, slept } = harness(0);

    const submission = await sink.submit(MAIL);

    expect(inner.submissions).toHaveLength(1);
    expect(slept).toEqual([]);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.line).toMatchObject({
      kind: 'mail',
      event: 'mail_submitted',
      messageId: submission.messageId,
      attempt: 1,
    });
  });

  it('retries through transient failures, honouring the backoff schedule', async () => {
    const { sink, inner, lines, slept } = harness(2);

    const submission = await sink.submit(MAIL);

    expect(inner.submissions).toHaveLength(1);
    expect(slept).toEqual([10, 20]);
    const events = lines.map((l) => l.line['event']);
    expect(events).toEqual(['mail_submission_retry', 'mail_submission_retry', 'mail_submitted']);
    expect(lines[2]?.line['messageId']).toBe(submission.messageId);
    expect(lines[2]?.line['attempt']).toBe(3);
  });

  it('gives up after the configured attempts, logging the terminal failure', async () => {
    const { sink, inner, lines, slept } = harness(3);

    await expect(sink.submit(MAIL)).rejects.toThrowError(MailSubmissionError);
    await expect(sink.submit(MAIL)).resolves.toBeDefined();

    expect(inner.submissions).toHaveLength(1);
    expect(slept).toEqual([10, 20]);
    const terminal = lines.find((l) => l.line['event'] === 'mail_submission_failed');
    expect(terminal?.level).toBe('error');
    expect(terminal?.line).toMatchObject({ attempts: 3, to: ['customer@example.com'] });
  });

  it('reports how many attempts were made on the thrown error', async () => {
    const { sink } = harness(5, 2, [0]);

    const failure = await sink.submit(MAIL).catch((e: unknown) => e);

    expect(failure).toBeInstanceOf(MailSubmissionError);
    expect((failure as MailSubmissionError).attempts).toBe(2);
  });
});

describe('RetryingMailSink — one correlation id per logical send', () => {
  it('hands every attempt the same id, and returns that id', async () => {
    const { sink, inner } = harness(2);

    const submission = await sink.submit(MAIL);

    expect(inner.attemptedMessageIds).toHaveLength(3);
    expect(new Set(inner.attemptedMessageIds).size).toBe(1);
    expect(inner.attemptedMessageIds[0]).toBe(submission.messageId);
  });

  it('logs the id on retries and on terminal failure, not just on success', async () => {
    const { sink, inner, lines } = harness(3);

    await expect(sink.submit(MAIL)).rejects.toThrowError(MailSubmissionError);

    const ids = lines.map((l) => l.line['messageId']);
    expect(ids).toHaveLength(4);
    expect(ids.every((id) => typeof id === 'string' && id.length > 0)).toBe(true);
    expect(new Set(ids).size).toBe(1);

    expect(new Set(inner.attemptedMessageIds)).toEqual(new Set(ids));
  });

  it('reuses a caller-supplied id rather than minting its own', async () => {
    const { sink, inner } = harness(1);

    const submission = await sink.submit(MAIL, '<fixed@example.test>');

    expect(inner.attemptedMessageIds).toEqual(['<fixed@example.test>', '<fixed@example.test>']);
    expect(submission.messageId).toBe('<fixed@example.test>');
  });

  it('mints through the inner sink, so the id carries the sender domain', async () => {
    const { sink } = harness(0);

    expect(sink.mintMessageId()).toMatch(/^<[0-9a-f-]{36}@example\.test>$/);
  });
});

describe('RetryingMailSink — a permanent rejection is not retried', () => {
  it('gives up on the first 5xx instead of spending the backoff', async () => {
    const { sink, inner, slept } = harness(0);
    inner.rejectNextSubmissions(3);

    const failure = await sink.submit(MAIL).catch((e: unknown) => e);

    expect(inner.attemptedMessageIds).toHaveLength(1);
    expect(slept).toEqual([]);
    expect(failure).toBeInstanceOf(MailSubmissionError);
    expect((failure as MailSubmissionError).attempts).toBe(1);
    expect((failure as MailSubmissionError).permanent).toBe(true);
  });

  it('names the outcome rejection rather than exhaustion', async () => {
    const { sink, inner, lines } = harness(0);
    inner.rejectNextSubmissions(1);

    await expect(sink.submit(MAIL)).rejects.toThrowError(MailSubmissionError);

    const events = lines.map((l) => l.line['event']);
    expect(events).toEqual(['mail_submission_rejected']);
    expect(events).not.toContain('mail_submission_retry');
    expect(lines[0]?.level).toBe('error');
    expect(lines[0]?.line['messageId']).toBe(inner.attemptedMessageIds[0]);
  });

  it('still retries a transient failure — the distinction is the point', async () => {
    const { sink, inner, slept } = harness(2);

    await sink.submit(MAIL);

    expect(inner.attemptedMessageIds).toHaveLength(3);
    expect(slept).toEqual([10, 20]);
  });
});

describe('InMemoryMailSink', () => {
  it('mints unique real-shaped correlation ids like the real adapter', async () => {
    const sink = new InMemoryMailSink(clock);
    const first = await sink.submit(MAIL);
    const second = await sink.submit(MAIL);

    expect(first.messageId).toMatch(/^<[0-9a-f-]{36}@example\.test>$/);
    expect(first.messageId).not.toBe(second.messageId);
    expect(sink.submissions.map((s) => s.submission.messageId)).toEqual([
      first.messageId,
      second.messageId,
    ]);
  });
});
