// The test-mode redirect: who is diverted, how the subject names them, and that a retry resends the
// rewritten copy once.
import { describe, expect, it } from 'vitest';

import { InMemoryMailSink } from '../src/adapters/in-memory/in-memory-mail-sink';
import type { Clock, OutboundEmail } from '../src/ports';
import {
  RedirectingMailSink,
  planRedirect,
  redirectRecipients,
  type MailRedirect,
} from '../src/redirect';
import { RetryingMailSink, type MailLog } from '../src/retrying-mail-sink';

const clock: Clock = { now: () => new Date('2026-09-15T12:00:00Z') };

const silent: MailLog = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

const REDIRECT: MailRedirect = {
  to: 'erp-test@org.example.test',
  allow: ['demo-owner@org.example.test', 'demo-it@org.example.test'],
};

const QUOTE: OutboundEmail = {
  to: ['buyer@customer.example.test'],
  subject: 'Quote Q-5926',
  textBody: 'Attached.',
  attachments: [
    { filename: 'q.pdf', contentType: 'application/pdf', bytes: new Uint8Array([1, 2, 3]) },
  ],
};

describe('planRedirect', () => {
  it('leaves a message to an allowed tester exactly as it was', () => {
    const mail = { ...QUOTE, to: ['demo-owner@org.example.test'] };

    const plan = planRedirect(mail, REDIRECT);

    expect(plan.mail).toBe(mail);
    expect(plan.diverted).toEqual([]);
  });

  it('matches the allow list ignoring case', () => {
    const plan = planRedirect({ ...QUOTE, to: ['DEMO-IT@org.example.test'] }, REDIRECT);

    expect(plan.diverted).toEqual([]);
  });

  it('sends a customer message to the catch-all and names the customer in the subject', () => {
    const plan = planRedirect(QUOTE, REDIRECT);

    expect(plan.mail.to).toEqual(['erp-test@org.example.test']);
    expect(plan.mail.subject).toBe('[TEST, was to: buyer@customer.example.test] Quote Q-5926');
    expect(plan.diverted).toEqual(['buyer@customer.example.test']);
  });

  it('never touches the body or the attachments', () => {
    const plan = planRedirect(QUOTE, REDIRECT);

    expect(plan.mail.textBody).toBe(QUOTE.textBody);
    expect(plan.mail.attachments).toBe(QUOTE.attachments);
  });

  it('keeps an allowed recipient and adds the catch-all once for the rest', () => {
    const plan = planRedirect(
      {
        ...QUOTE,
        to: [
          'demo-owner@org.example.test',
          'buyer@customer.example.test',
          'ap@customer.example.test',
        ],
      },
      REDIRECT,
    );

    expect(plan.mail.to).toEqual(['demo-owner@org.example.test', 'erp-test@org.example.test']);
    expect(plan.diverted).toEqual(['buyer@customer.example.test', 'ap@customer.example.test']);
    expect(plan.mail.subject).toBe(
      '[TEST, was to: buyer@customer.example.test, ap@customer.example.test] Quote Q-5926',
    );
  });

  it('diverts cc recipients too', () => {
    const plan = planRedirect(
      { ...QUOTE, to: ['demo-owner@org.example.test'], cc: ['boss@customer.example.test'] },
      REDIRECT,
    );

    expect(plan.mail.to).toEqual(['demo-owner@org.example.test', 'erp-test@org.example.test']);
    expect(plan.mail.cc).toEqual([]);
    expect(plan.diverted).toEqual(['boss@customer.example.test']);
  });

  it('names an address once when it appears twice', () => {
    const plan = planRedirect(
      { ...QUOTE, to: ['buyer@customer.example.test'], cc: ['BUYER@customer.example.test'] },
      REDIRECT,
    );

    expect(plan.diverted).toEqual(['buyer@customer.example.test']);
    expect(plan.mail.to).toEqual(['erp-test@org.example.test']);
  });

  it('does not add the catch-all when it is already on the message', () => {
    const plan = planRedirect(
      { ...QUOTE, to: ['erp-test@org.example.test', 'buyer@customer.example.test'] },
      { ...REDIRECT, allow: [...REDIRECT.allow, 'erp-test@org.example.test'] },
    );

    expect(plan.mail.to).toEqual(['erp-test@org.example.test']);
  });

  it('diverts everyone when the allow list is empty', () => {
    const plan = planRedirect(
      { ...QUOTE, to: ['demo-owner@org.example.test'] },
      { to: REDIRECT.to, allow: [] },
    );

    expect(plan.mail.to).toEqual(['erp-test@org.example.test']);
  });
});

describe('redirectRecipients', () => {
  it('answers the recipient half on its own, for the log and the receipts', () => {
    expect(redirectRecipients({ to: ['buyer@customer.example.test'] }, REDIRECT)).toEqual({
      to: ['erp-test@org.example.test'],
      diverted: ['buyer@customer.example.test'],
    });
  });

  it('diverts nothing for a tester on the list', () => {
    expect(redirectRecipients({ to: ['demo-owner@org.example.test'] }, REDIRECT).diverted).toEqual(
      [],
    );
  });
});

describe('RedirectingMailSink', () => {
  it('hands the relay the rewritten message', async () => {
    const inner = new InMemoryMailSink(clock);
    const sink = new RedirectingMailSink(inner, REDIRECT);

    await sink.submit(QUOTE);

    expect(inner.submissions[0]?.mail.to).toEqual(['erp-test@org.example.test']);
    expect(inner.submissions[0]?.mail.subject).toBe(
      '[TEST, was to: buyer@customer.example.test] Quote Q-5926',
    );
  });

  it("keeps the caller's correlation id", async () => {
    const inner = new InMemoryMailSink(clock);
    const sink = new RedirectingMailSink(inner, REDIRECT);
    const id = sink.mintMessageId();

    const submission = await sink.submit(QUOTE, id);

    expect(submission.messageId).toBe(id);
  });

  it('rewrites once, so a retry resends the rewritten copy and not a twice-prefixed one', async () => {
    const inner = new InMemoryMailSink(clock);
    inner.failNextSubmissions(1);
    const sink = new RedirectingMailSink(
      new RetryingMailSink(inner, silent, { attempts: 2, delaysMs: [0] }, async () => undefined),
      REDIRECT,
    );

    await sink.submit(QUOTE);

    expect(inner.attemptedMessageIds).toHaveLength(2);
    expect(inner.submissions[0]?.mail.subject).toBe(
      '[TEST, was to: buyer@customer.example.test] Quote Q-5926',
    );
  });
});
