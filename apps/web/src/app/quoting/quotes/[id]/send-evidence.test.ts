// Tests the Sends fold's wording for accepted, refused and undeliverable emails.
import type { QuoteSendAttempt } from '@erp/types';
import { FAILURE_NOTICE_ACTOR } from '@erp/types';
import { describe, expect, it } from 'vitest';

import { sendEvidence } from './send-evidence';

const attempt = (over: Partial<QuoteSendAttempt> = {}): QuoteSendAttempt => ({
  messageId: `<${Math.random().toString(36).slice(2)}@example.test>`,
  recipients: ['fixture-18@example.test'],
  audience: 'customer',
  actor: 'dev-sales',
  submittedAt: '2026-08-28T21:14:00.000Z',
  outcome: 'accepted',
  unreachableHolders: [],
  ...over,
});

describe('sendEvidence', () => {
  it('says nothing when nothing was ever sent', () => {
    expect(sendEvidence([])).toEqual({ lines: [] });
  });

  it('names the addresses a successful copy went to', () => {
    const [line] = sendEvidence([
      attempt({ recipients: ['fixture-18@example.test', 'fixture-06@example.test'] }),
    ]).lines;

    expect(line).toMatchObject({
      tone: 'sent',
      what: 'Emailed to the customer',
      to: 'fixture-18@example.test, fixture-06@example.test',
      actor: 'dev-sales',
    });

    expect(line).not.toHaveProperty('why');
  });

  it('says where a test-mode send really went', () => {
    const [line] = sendEvidence([
      attempt({
        recipients: ['fixture-18@example.test'],
        redirectedTo: ['fixture-24@example.test'],
      }),
    ]).lines;

    expect(line?.to).toBe('fixture-18@example.test (test mode: went to fixture-24@example.test)');
  });

  it('tells the customer copy from the production alert', () => {
    const { lines } = sendEvidence([
      attempt({ audience: 'internal', recipients: ['fixture-34@example.test'] }),
      attempt({ audience: 'customer' }),
    ]);

    expect(lines.map((line) => line.what)).toEqual([
      'Production told it went out',
      'Emailed to the customer',
    ]);
  });

  it('tells the lead-time request from the quote-sent alert', () => {
    const { lines } = sendEvidence([
      attempt({ audience: 'internal', kind: 'lead-time-request', outcome: 'failed' }),
      attempt({ audience: 'internal', kind: 'lead-time-request' }),
      attempt({ audience: 'internal' }),
    ]);

    expect(lines.map((line) => line.what)).toEqual([
      'Production was not asked for a lead time',
      'Production asked for a lead time',
      'Production told it went out',
    ]);
    expect(lines[0]?.why).toContain('Needs a lead time queue');
  });

  describe('when the relay refused it', () => {
    it('says so plainly, and what to do next', () => {
      const [line] = sendEvidence([attempt({ outcome: 'failed' })]).lines;

      expect(line?.tone).toBe('failed');
      expect(line?.what).toBe('Not emailed to the customer');

      expect(line?.to).toBe('fixture-18@example.test');
      expect(line?.why).toBe(
        'The mail relay refused it, so nobody received this copy. Try again; if it keeps failing, tell an administrator.',
      );
    });

    it('points at the ordinary button when nothing has ever arrived', () => {
      const { retry } = sendEvidence([attempt({ outcome: 'failed' })]);

      expect(retry).toBe('Nothing has reached the customer yet. The send button tries again.');
    });

    it('points at Send another copy when an earlier copy did arrive', () => {
      const { retry } = sendEvidence([
        attempt({ outcome: 'failed', submittedAt: '2026-08-28T22:00:00.000Z' }),
        attempt({ outcome: 'accepted', submittedAt: '2026-08-28T21:00:00.000Z' }),
      ]);

      expect(retry).toBe('The customer holds an earlier copy, so the button below sends another.');
    });

    it('says the alert failed differently from the customer copy', () => {
      const [line] = sendEvidence([attempt({ audience: 'internal', outcome: 'failed' })]).lines;

      expect(line?.what).toBe('Production was not told');
      expect(line?.why).toContain('production was not told this quote went out');
    });
  });

  describe('when there was nobody to send to', () => {
    it('names the missing role rather than suggesting a retry', () => {
      const [line] = sendEvidence([
        attempt({
          audience: 'internal',
          outcome: 'failed',
          failureReason: 'no-holders',
          recipients: [],
        }),
      ]).lines;

      expect(line?.why).toBe(
        'Nobody holds the Production Manager role, so there was nobody to tell. An administrator grants it on the users screen.',
      );
      expect(line?.why).not.toContain('Try again');
      expect(line?.to).toBe('no recipients');
    });

    it('names the holder an administrator has to fix', () => {
      const [line] = sendEvidence([
        attempt({
          audience: 'internal',
          outcome: 'failed',
          failureReason: 'no-addresses',
          recipients: [],
          unreachableHolders: ['demo-production', 'jdoe'],
        }),
      ]).lines;

      expect(line?.why).toContain('demo-production, jdoe');
    });
  });

  it('offers no retry line while the latest copy is fine', () => {
    const { lines, retry } = sendEvidence([
      attempt({ outcome: 'accepted', submittedAt: '2026-08-28T22:00:00.000Z' }),
      attempt({ outcome: 'failed', submittedAt: '2026-08-28T21:00:00.000Z' }),
    ]);

    expect(lines.map((line) => line.tone)).toEqual(['sent', 'failed']);
    expect(retry).toBeUndefined();
  });

  it('calls a failure notice what it is, not the production alert', () => {
    const [sent] = sendEvidence([
      attempt({
        audience: 'internal',
        actor: FAILURE_NOTICE_ACTOR,
        recipients: ['fixture-22@example.test'],
        outcome: 'accepted',
      }),
    ]).lines;

    expect(sent?.what).toBe('The sender was emailed that an email about this quote failed');

    expect(sent?.actor).toBe('the system, automatically');

    const [failed] = sendEvidence([
      attempt({
        audience: 'internal',
        actor: FAILURE_NOTICE_ACTOR,
        recipients: ['fixture-22@example.test'],
        outcome: 'failed',
      }),
    ]).lines;

    expect(failed?.what).toBe('The sender could not be told that an email about this quote failed');
    expect(failed?.why).toContain('has not been told');
    expect(failed?.why).not.toContain('production was not told');
  });

  it('ignores a notice when deciding whether to offer a retry', () => {
    const { retry } = sendEvidence([
      attempt({
        audience: 'internal',
        actor: FAILURE_NOTICE_ACTOR,
        outcome: 'accepted',
        submittedAt: '2026-08-28T22:00:00.000Z',
      }),
      attempt({ outcome: 'accepted', submittedAt: '2026-08-28T21:00:00.000Z' }),
    ]);

    expect(retry).toBeUndefined();
  });

  it('ignores a failed alert when deciding whether to offer a retry', () => {
    const { retry } = sendEvidence([
      attempt({
        audience: 'internal',
        outcome: 'failed',
        failureReason: 'no-holders',
        recipients: [],
        submittedAt: '2026-08-28T22:00:00.000Z',
      }),
      attempt({ outcome: 'accepted', submittedAt: '2026-08-28T21:00:00.000Z' }),
    ]);

    expect(retry).toBeUndefined();
  });
});
