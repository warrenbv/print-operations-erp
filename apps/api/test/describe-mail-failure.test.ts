// Tests `describeMailFailure` in apps/api/src/notifications/describe-mail-failure.ts.
import { MailSubmissionError } from '@erp/notifications';
import { SEND_FAILURE_DETAIL_MAX } from '@erp/types';
import { describe, expect, it } from 'vitest';

import { describeMailFailure } from '../src/notifications/describe-mail-failure';

describe('describeMailFailure', () => {
  it('reads the whole cause chain, so the relay reply survives our own wrappers', () => {
    const nodemailer = new Error('550 5.1.1 <ap@acme.example.test>: unknown user');
    const adapter = new MailSubmissionError(
      'relay at mail.org.example.test:25 did not accept the message',
      1,
      nodemailer,
      true,
    );
    const thrown = new MailSubmissionError(
      'mail submission was permanently rejected on attempt 1',
      1,
      adapter,
      true,
    );

    expect(describeMailFailure(thrown)).toEqual({
      failureDetail:
        'mail submission was permanently rejected on attempt 1: ' +
        'relay at mail.org.example.test:25 did not accept the message: ' +
        '550 5.1.1 <ap@acme.example.test>: unknown user',
      failurePermanent: true,
    });
  });

  it('records an unreachable relay as not permanent, which is the retryable half', () => {
    const thrown = new MailSubmissionError(
      'mail submission failed after 3 attempts',
      3,
      new Error('connect ECONNREFUSED 192.0.2.5:25'),
    );

    expect(describeMailFailure(thrown)).toEqual({
      failureDetail: 'mail submission failed after 3 attempts: connect ECONNREFUSED 192.0.2.5:25',
      failurePermanent: false,
    });
  });

  it('keeps false rather than dropping it', () => {
    expect(describeMailFailure(new MailSubmissionError('gave up', 3))).toHaveProperty(
      'failurePermanent',
      false,
    );
  });

  it('says nothing about permanence when the cause is not a submission failure', () => {
    const described = describeMailFailure(new TypeError('to is not iterable'));

    expect(described).toEqual({ failureDetail: 'to is not iterable' });
    expect(described).not.toHaveProperty('failurePermanent');
  });

  it('does not repeat a message a wrapper rethrew unchanged', () => {
    const inner = new Error('relay refused');
    const outer = new MailSubmissionError('relay refused', 1, inner);

    expect(describeMailFailure(outer).failureDetail).toBe('relay refused');
  });

  it('truncates rather than storing an unbounded blob', () => {
    const detail = describeMailFailure(new Error('x'.repeat(SEND_FAILURE_DETAIL_MAX * 2)));

    expect(detail.failureDetail).toHaveLength(SEND_FAILURE_DETAIL_MAX);
    expect(detail.failureDetail?.endsWith('...')).toBe(true);
  });

  it('survives a cause cycle instead of spinning', () => {
    const a = new Error('a');
    const b = new Error('b', { cause: a });
    (a as { cause?: unknown }).cause = b;

    expect(describeMailFailure(b).failureDetail).toBe('b: a');
  });

  it('describes a thrown non-error without pretending it knows more', () => {
    expect(describeMailFailure('the relay went away')).toEqual({
      failureDetail: 'the relay went away',
    });
  });

  it('records nothing at all rather than an empty detail', () => {
    expect(describeMailFailure(new Error(''))).toEqual({});
  });
});
