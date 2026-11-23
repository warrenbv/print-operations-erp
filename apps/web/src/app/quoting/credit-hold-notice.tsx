// The credit-hold banner and the exception panel beneath it.
// They say what a hold stops and what it does not: docs/product/requirements.md (R2) and docs/product/decisions.md.
// The state they render comes from apps/web/src/app/quoting/credit-exception.ts.
import type { Customer } from '@erp/types';

import { Button, COLOR, DangerBanner, Hint, Input, SPACE } from '@erp/ui';

import { formatDay } from '../../lib/dates';
import { CREDIT_HOLD_SENTENCE } from '../../lib/helptext';
import { requestCreditExceptionAction } from './credit-exception-actions';
import { offersRequestForm, type CreditExceptionState } from './credit-exception';

export function CreditHoldNotice({ customer }: { customer: Customer }) {
  return (
    <DangerBanner>
      {CREDIT_HOLD_SENTENCE}
      {customer.creditHoldSetBy !== undefined && (
        <span style={{ color: COLOR.muted }}>
          {' '}
          Set by {customer.creditHoldSetBy}
          {customer.creditHoldSetAt !== undefined && ` on ${formatDay(customer.creditHoldSetAt)}`}.
        </span>
      )}
    </DangerBanner>
  );
}

interface ExceptionProps {
  readonly customer: Customer;
  readonly state: CreditExceptionState;

  readonly quoteId?: string;

  readonly q?: string;

  readonly from?: 'customer';
}

export function CreditExceptionSection({ customer, state, quoteId, q, from }: ExceptionProps) {
  if (state.kind === 'not-held') {
    return null;
  }

  return (
    <div style={{ marginTop: SPACE.md }}>
      {state.kind === 'pending' && (
        <p style={{ margin: 0 }}>
          <strong>Exception requested</strong> by {state.approval.requestedBy} on{' '}
          {formatDay(state.approval.requestedAt)}. The Billing Manager decides it from Approvals.
        </p>
      )}

      {state.kind === 'approved' && (
        <p style={{ margin: 0 }}>
          <strong>Exception approved</strong>
          {state.approval.decidedBy !== undefined && <> by {state.approval.decidedBy}</>}
          {state.approval.decidedAt !== undefined && <> on {formatDay(state.approval.decidedAt)}</>}
          . It permits one quote and is used up by starting it. The account stays on hold.
        </p>
      )}

      {state.kind === 'rejected' && (
        <p style={{ margin: 0 }}>
          <strong>Exception refused</strong>
          {state.approval.decidedBy !== undefined && <> by {state.approval.decidedBy}</>}
          {state.approval.decidedAt !== undefined && <> on {formatDay(state.approval.decidedAt)}</>}

          {state.approval.decisionReason !== undefined && (
            <>: &ldquo;{state.approval.decisionReason}&rdquo;</>
          )}
        </p>
      )}

      {offersRequestForm(state) && (
        <form
          action={requestCreditExceptionAction}
          style={{ display: 'flex', gap: SPACE.md, marginTop: SPACE.md, flexWrap: 'wrap' }}
        >
          <input type="hidden" name="customerId" value={customer.id} />
          {quoteId !== undefined && <input type="hidden" name="quoteId" value={quoteId} />}
          {q !== undefined && <input type="hidden" name="q" value={q} />}
          {from !== undefined && <input type="hidden" name="from" value={from} />}
          <Input
            type="text"
            name="reason"
            placeholder="Why this account should be quoted anyway (required)"
            style={{ flex: 1, minWidth: 220 }}
          />
          <Button>Request an exception</Button>
        </form>
      )}

      {offersRequestForm(state) && (
        <p style={{ marginTop: SPACE.sm }}>
          <Hint>
            {state.kind === 'rejected'
              ? 'Answer what the Billing Manager said, or the same answer follows.'
              : 'The Billing Manager decides. An approval permits one quote and the hold stays.'}
          </Hint>
        </p>
      )}
    </div>
  );
}
