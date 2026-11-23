// Tests the wording of the notice in apps/api/src/notifications/failure-notice.ts.
import { shortId, type SendSubjectType } from '@erp/types';
import { describe, expect, it } from 'vitest';

import { failureNoticeMessage, type FailureNotice } from '../src/notifications/failure-notice';

const ID = '01a01a98-d215-76bd-ae1e-99bb52bdc29b';

function notice(over: Partial<FailureNotice> = {}): FailureNotice {
  return {
    subject: { type: 'quote', id: ID, label: 'Q-00318' },
    audience: 'customer',
    recipients: ['buyer@acme.example.test'],
    cause: { kind: 'relay-refused', permanent: false },
    ...over,
  };
}

describe('the subject line', () => {
  it('names the thing the failed email was about by its number', () => {
    expect(failureNoticeMessage(notice()).subject).toBe(
      'An email about quote Q-00318 did not go out',
    );
  });

  const LABELS: Record<SendSubjectType, [string, string]> = {
    quote: ['Q-00318 v2', 'quote Q-00318 v2'],
    order: ['DPW-00264', 'order DPW-00264'],
  };

  for (const [type, [label, named]] of Object.entries(LABELS)) {
    it(`names a ${type} by its label, in the subject line and the body`, () => {
      const message = failureNoticeMessage(
        notice({ subject: { type: type as SendSubjectType, id: ID, label } }),
      );
      expect(message.subject).toBe(`An email about ${named} did not go out`);
      expect(message.textBody).toContain(`(${label})`);

      expect(`${message.subject} ${message.textBody}`).not.toContain(shortId(ID));
    });
  }

  it('carries no issue number, because a person reads it', () => {
    const message = failureNoticeMessage(
      notice({
        cause: {
          kind: 'nobody-to-send-to',
          reason: 'no-holders',
          unreachableHolders: [],
          stands: 'The quote itself went to the customer as normal.',
        },
      }),
    );
    expect(`${message.subject} ${message.textBody}`).not.toMatch(/#\d+/);
  });
});

describe('what was being sent', () => {
  const customerWordings: Record<SendSubjectType, string> = {
    quote: "The customer's copy of a quote you sent",
    order: 'The order confirmation for a customer',
  };

  for (const [type, wording] of Object.entries(customerWordings)) {
    it(`says what a failed customer ${type} email was`, () => {
      const body = failureNoticeMessage(
        notice({
          subject: { type: type as SendSubjectType, id: ID, label: 'X-1' },
          audience: 'customer',
        }),
      ).textBody;
      expect(body).toContain(wording);
    });
  }

  it('distinguishes the internal alert from the customer copy on one subject', () => {
    const customer = failureNoticeMessage(
      notice({
        subject: { type: 'order', id: ID, label: 'DPW-00264' },
        audience: 'customer',
      }),
    ).textBody;
    const internal = failureNoticeMessage(
      notice({
        subject: { type: 'order', id: ID, label: 'DPW-00264' },
        audience: 'internal',
      }),
    ).textBody;

    expect(customer).toContain('The order confirmation for a customer');

    expect(internal).toContain('The alert telling production about a purchase order');
  });
});

describe('who it was for', () => {
  it('lists the addresses the ERP resolved', () => {
    const body = failureNoticeMessage(
      notice({ recipients: ['ap@acme.example.test', 'buyer@acme.example.test'] }),
    ).textBody;
    expect(body).toContain('It was addressed to ap@acme.example.test, buyer@acme.example.test.');
  });

  it('says there was nobody rather than leaving a blank to interpret', () => {
    const body = failureNoticeMessage(
      notice({
        recipients: [],
        cause: {
          kind: 'nobody-to-send-to',
          reason: 'no-holders',
          unreachableHolders: [],
          stands: 'The quote itself went to the customer as normal.',
        },
      }),
    ).textBody;
    expect(body).toContain('There was nobody to send it to.');
  });
});

describe('three causes, three things to do', () => {
  it('a permanent refusal is not worth retrying, and quotes the relay', () => {
    const body = failureNoticeMessage(
      notice({ cause: { kind: 'relay-refused', permanent: true, detail: '550 unknown user' } }),
    ).textBody;
    expect(body).toContain('refused it outright');
    expect(body).toContain('not worth retrying');
    expect(body).toContain('The relay said: 550 unknown user');
  });

  it('a transient refusal invites another try', () => {
    const body = failureNoticeMessage(
      notice({ cause: { kind: 'relay-refused', permanent: false } }),
    ).textBody;
    expect(body).toContain('could not be reached');
    expect(body).toContain('Sending it again is worth doing');
    expect(body).not.toContain('The relay said');
  });

  it('a configuration gap sends the reader to an administrator, not to a retry', () => {
    const body = failureNoticeMessage(
      notice({
        recipients: [],
        cause: {
          kind: 'nobody-to-send-to',
          reason: 'no-holders',
          unreachableHolders: [],
          stands: 'The quote itself went to the customer as normal.',
        },
      }),
    ).textBody;
    expect(body).toContain('An administrator grants that role on the users screen.');
    expect(body).toContain('will not help until somebody holds it');
  });

  it('says what still stands, so the reader does not chase a document that arrived', () => {
    const body = failureNoticeMessage(
      notice({
        recipients: [],
        cause: {
          kind: 'nobody-to-send-to',
          reason: 'no-addresses',
          unreachableHolders: ['zoe'],
          stands: 'The bill itself went to the customer as normal.',
        },
      }),
    ).textBody;
    expect(body).toContain('The bill itself went to the customer as normal.');
    expect(body).toContain('(zoe)');
  });
});
