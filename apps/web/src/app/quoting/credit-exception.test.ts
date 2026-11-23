// Tests where a held customer stands on an exception, and when a quote may be started.
import type { QuoteApproval } from '@erp/types';
import { describe, expect, it } from 'vitest';

import { creditExceptionState, mayStartQuote, offersRequestForm } from './credit-exception';

const CUSTOMER = '01988a00-0001-7000-8000-000000000001';

function approval(over: Partial<QuoteApproval> = {}): QuoteApproval {
  return {
    id: '01988a00-0002-7000-8000-000000000001',
    customerId: CUSTOMER,
    status: 'pending',
    reason: 'PO already in hand',
    requestedBy: 'dev-sales',
    requestedAt: '2026-08-20T17:00:00.000Z',
    ...over,
  };
}

describe('creditExceptionState', () => {
  it('is not-held for an account with no hold, whatever its history', () => {
    const state = creditExceptionState({ creditHold: false }, [
      approval({ status: 'approved', spentByQuoteId: CUSTOMER }),
    ]);

    expect(state).toEqual({ kind: 'not-held' });
  });

  it('offers the form on a held account nobody has asked about', () => {
    expect(creditExceptionState({ creditHold: true }, [])).toEqual({ kind: 'may-ask' });
  });

  it('reports a pending request rather than offering a second form', () => {
    const pending = approval();

    const state = creditExceptionState({ creditHold: true }, [pending]);

    expect(state).toEqual({ kind: 'pending', approval: pending });
    expect(offersRequestForm(state)).toBe(false);
  });

  it('reports the newest pending request when more than one was raised', () => {
    const older = approval({ id: 'a-old', requestedAt: '2026-08-20T16:00:00.000Z' });
    const newer = approval({ id: 'a-new', requestedAt: '2026-08-20T18:00:00.000Z' });

    expect(creditExceptionState({ creditHold: true }, [older, newer])).toEqual({
      kind: 'pending',
      approval: newer,
    });
  });

  it('reports an unspent approval, and lets a quote start', () => {
    const token = approval({ status: 'approved', decidedBy: 'dev-billing' });

    const state = creditExceptionState({ creditHold: true }, [token]);

    expect(state).toEqual({ kind: 'approved', approval: token });
    expect(mayStartQuote(state)).toBe(true);

    expect(offersRequestForm(state)).toBe(false);
  });

  it('prefers an unspent approval over a newer pending request', () => {
    const token = approval({
      id: 'a-token',
      status: 'approved',
      requestedAt: '2026-08-20T16:00:00.000Z',
    });
    const laterAsk = approval({ id: 'a-later', requestedAt: '2026-08-20T18:00:00.000Z' });

    expect(creditExceptionState({ creditHold: true }, [laterAsk, token])).toEqual({
      kind: 'approved',
      approval: token,
    });
  });

  it('ignores an approval that has already been spent', () => {
    const spent = approval({
      status: 'approved',
      spentByQuoteId: '01988a00-0003-7000-8000-000000000001',
      spentAt: '2026-08-20T18:00:00.000Z',
    });

    const state = creditExceptionState({ creditHold: true }, [spent]);

    expect(state).toEqual({ kind: 'may-ask' });
    expect(mayStartQuote(state)).toBe(false);
  });

  it('reports the newest rejection with its reason, and offers the form again', () => {
    const older = approval({
      id: 'a-old',
      status: 'rejected',
      requestedAt: '2026-08-20T16:00:00.000Z',
      decisionReason: 'Balance is 90 days out',
    });
    const newer = approval({
      id: 'a-new',
      status: 'rejected',
      requestedAt: '2026-08-20T18:00:00.000Z',
      decisionReason: 'Still nothing paid',
    });

    const state = creditExceptionState({ creditHold: true }, [older, newer]);

    expect(state).toEqual({ kind: 'rejected', approval: newer });

    expect(offersRequestForm(state)).toBe(true);
    expect(mayStartQuote(state)).toBe(false);
  });

  it('prefers a pending request over an older rejection', () => {
    const rejected = approval({
      id: 'a-rejected',
      status: 'rejected',
      requestedAt: '2026-08-20T16:00:00.000Z',
      decisionReason: 'Balance is 90 days out',
    });
    const asked = approval({ id: 'a-asked', requestedAt: '2026-08-20T18:00:00.000Z' });

    expect(creditExceptionState({ creditHold: true }, [rejected, asked])).toEqual({
      kind: 'pending',
      approval: asked,
    });
  });

  it('does not depend on the order the approvals arrive in', () => {
    const rows = [
      approval({ id: 'a-1', status: 'rejected', requestedAt: '2026-08-20T15:00:00.000Z' }),
      approval({ id: 'a-2', status: 'approved', requestedAt: '2026-08-20T16:00:00.000Z' }),
      approval({ id: 'a-3', status: 'pending', requestedAt: '2026-08-20T17:00:00.000Z' }),
    ];

    const forwards = creditExceptionState({ creditHold: true }, rows);
    const backwards = creditExceptionState({ creditHold: true }, [...rows].reverse());

    expect(forwards).toEqual(backwards);
    expect(forwards.kind).toBe('approved');
  });
});

describe('mayStartQuote', () => {
  it('is true only when nothing stops the quote, or a token permits it', () => {
    expect(mayStartQuote({ kind: 'not-held' })).toBe(true);
    expect(mayStartQuote({ kind: 'approved', approval: approval({ status: 'approved' }) })).toBe(
      true,
    );
    expect(mayStartQuote({ kind: 'may-ask' })).toBe(false);
    expect(mayStartQuote({ kind: 'pending', approval: approval() })).toBe(false);
    expect(mayStartQuote({ kind: 'rejected', approval: approval({ status: 'rejected' }) })).toBe(
      false,
    );
  });
});
