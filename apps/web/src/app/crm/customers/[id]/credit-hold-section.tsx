// The Credit hold section, drawn for the Billing Manager and Admin only: docs/product/requirements.md (R2).
// The Billing Manager sets a hold on the word of the person who manages receivables: docs/product/roles.md.
import type { Customer } from '@erp/types';
import { Button, COLOR, DL, Section, SPACE } from '@erp/ui';

import { formatTimestamp } from '../../../../lib/dates';
import { setCreditHoldAction } from './credit-hold-actions';
import { creditHoldAct } from './credit-hold';

export function CreditHoldSection({ customer }: { customer: Customer }) {
  const act = creditHoldAct(customer.creditHold);

  return (
    <Section
      title="Credit hold"
      note={
        customer.creditHold
          ? 'Lifting the hold lets anyone quote this account again.'
          : 'A held account cannot be quoted. Set it on the word of whoever manages receivables.'
      }
    >
      <DL style={{ marginBottom: SPACE.lg }}>
        <dt>Status</dt>
        <dd>{customer.creditHold ? 'On credit hold' : 'Not on credit hold'}</dd>

        <dt>Last set by</dt>
        <dd>
          {customer.creditHoldSetBy === undefined ? (
            <em style={{ color: COLOR.muted }}>never set</em>
          ) : (
            <>
              {customer.creditHoldSetBy}
              {customer.creditHoldSetAt !== undefined && (
                <span style={{ color: COLOR.muted }}>
                  {' '}
                  on {formatTimestamp(customer.creditHoldSetAt)}
                </span>
              )}
            </>
          )}
        </dd>
      </DL>

      <form action={setCreditHoldAction}>
        <input type="hidden" name="customerId" value={customer.id} />

        <input type="hidden" name="lockVersion" value={customer.lockVersion} />

        <input type="hidden" name="held" value={act.nextHeld ? 'true' : 'false'} />
        <Button>{act.label}</Button>
      </form>
    </Section>
  );
}
