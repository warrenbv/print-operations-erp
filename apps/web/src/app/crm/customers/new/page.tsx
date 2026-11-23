// New customer. Sales and Admin may add one: docs/product/roles.md.
// The form carries a fresh submission token, so a double submit adds one customer.
// Opened from New quote, it also asks for the quote contact and returns there.
import { Button, COLOR, ErrorBanner, PageLede, PageShell, SectionNote, SPACE } from '@erp/ui';

import { submitted } from '../../../../lib/form-echo';
import { onlyDesk } from '../../../../lib/helptext';
import { loadMe } from '../../../../lib/load-me';
import { RETURN_TO_FIELD, resolveReturnTo } from '../../../../lib/return-to';
import { maySalesWrite } from '../../../../lib/roles';
import { loadSalesReps } from '../../../../lib/sales-reps';
import { SUBMISSION_TOKEN_FIELD, mintSubmissionToken } from '../../../../lib/submission-token';
import { createCustomerAction } from '../actions';
import { CustomerFormFields, CustomerFormHead } from '../customer-form';
import { CUSTOMER_FORM_ID } from '../customer-form-id';

export const metadata = { title: 'New customer' };

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function NewCustomerPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const error = typeof params.error === 'string' ? params.error : undefined;
  const returnTo = resolveReturnTo(typeof params.returnTo === 'string' ? params.returnTo : '');
  const echo = submitted(params);

  const me = await loadMe();
  if (me === null) {
    return (
      <PageShell>
        <h1>New customer</h1>
        <p>
          <a href="/login" style={{ color: COLOR.accent }}>
            Sign in
          </a>{' '}
          to view this page.
        </p>
      </PageShell>
    );
  }

  const canWrite = maySalesWrite(me.roles);
  if (!canWrite) {
    return (
      <PageShell>
        <h1>New customer</h1>

        <PageLede>{onlyDesk('Sales', 'adds a customer')}</PageLede>
        <BackLink />
      </PageShell>
    );
  }

  const reps = await loadSalesReps();

  const saveLabel = returnTo === undefined ? 'Add customer' : 'Add customer and return';

  return (
    <PageShell>
      <CustomerFormHead title="New customer" saveLabel={saveLabel} />
      <PageLede>
        A new account. The billing address is where the bill goes; the shipping address is where
        goods go.
      </PageLede>
      <BackLink returnTo={returnTo} />

      <ErrorBanner message={error} />

      {returnTo !== undefined && (
        <SectionNote>
          For a quote, so a billing address and one contact to email are required.
        </SectionNote>
      )}

      <form id={CUSTOMER_FORM_ID} action={createCustomerAction} style={formStyle}>
        <input type="hidden" name={SUBMISSION_TOKEN_FIELD} value={mintSubmissionToken()} />

        {returnTo !== undefined && <input type="hidden" name={RETURN_TO_FIELD} value={returnTo} />}
        <CustomerFormFields reps={reps} forQuote={returnTo !== undefined} echo={echo} />
        <div>
          <Button>{saveLabel}</Button>
        </div>
      </form>
    </PageShell>
  );
}

function BackLink({ returnTo }: { returnTo?: string }) {
  return (
    <p style={{ marginBottom: SPACE.md }}>
      <a href={returnTo ?? '/crm/customers'} style={{ color: COLOR.accent }}>
        {returnTo === undefined ? '← Customers' : '← Back to the quote'}
      </a>
    </p>
  );
}

const formStyle = { display: 'grid', gap: SPACE.lg, marginTop: SPACE.xl } as const;
