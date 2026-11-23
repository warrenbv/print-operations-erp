// Edit customer. Sales and Admin may edit. The form posts the customer's `lockVersion`, so a save over a
// change someone else made is refused: docs/decisions/006-optimistic-concurrency.md.
import { notFound } from 'next/navigation';

import { customerSchema, type Customer } from '@erp/types';
import { Button, COLOR, DangerBanner, ErrorBanner, PageLede, PageShell, SPACE } from '@erp/ui';

import { fetchParsed } from '../../../../../lib/fetch-parsed';
import { CREDIT_HOLD_SENTENCE, onlyDesk } from '../../../../../lib/helptext';
import { loadMe } from '../../../../../lib/load-me';
import { maySalesWrite } from '../../../../../lib/roles';
import { loadSalesReps, resolveFromOfferable } from '../../../../../lib/sales-reps';
import { updateCustomerAction } from '../../actions';
import { CustomerFormFields, CustomerFormHead } from '../../customer-form';
import { CUSTOMER_FORM_ID } from '../../customer-form-id';
import { recordTitle } from '../../../../../lib/record-title';

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}

async function loadCustomer(id: string): Promise<Customer | 'not-found'> {
  const customer = await fetchParsed(`/crm/customers/${encodeURIComponent(id)}`, customerSchema, {
    notFound: 'null',
  });
  return customer ?? 'not-found';
}

export async function generateMetadata({ params }: PageProps) {
  const { id } = await params;
  const title = await recordTitle(
    `/crm/customers/${encodeURIComponent(id)}`,
    customerSchema,
    (customer) => `Edit ${customer.name}`,
    'Edit customer',
  );
  return { title };
}

export default async function EditCustomerPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const { error } = await searchParams;

  const me = await loadMe();
  if (me === null) {
    return (
      <PageShell>
        <h1>Edit customer</h1>
        <p>
          <a href="/login" style={{ color: COLOR.accent }}>
            Sign in
          </a>{' '}
          to view this page.
        </p>
      </PageShell>
    );
  }

  const result = await loadCustomer(id);
  if (result === 'not-found') {
    notFound();
  }
  const customer = result;

  const canWrite = maySalesWrite(me.roles);
  if (!canWrite) {
    return (
      <PageShell>
        <h1>{customer.name}</h1>

        <PageLede>{onlyDesk('Sales', 'edits a customer')}</PageLede>
        <BackLink id={id} />
      </PageShell>
    );
  }

  const reps = await loadSalesReps();
  const storedRep =
    customer.accountRepUsername === undefined
      ? undefined
      : resolveFromOfferable(customer.accountRepUsername, reps);

  const saveLabel = 'Save customer';

  return (
    <PageShell>
      <CustomerFormHead title={customer.name} saveLabel={saveLabel} />

      <PageLede>Edit the account. Blanking a field clears it.</PageLede>
      <BackLink id={id} />

      <ErrorBanner message={error} />

      {customer.creditHold && (
        <DangerBanner>
          {CREDIT_HOLD_SENTENCE} Clearing a hold is the Billing Manager&apos;s decision and is not
          part of this form.
        </DangerBanner>
      )}

      <form id={CUSTOMER_FORM_ID} action={updateCustomerAction} style={formStyle}>
        <input type="hidden" name="customerId" value={customer.id} />

        <input type="hidden" name="lockVersion" value={customer.lockVersion} />
        <CustomerFormFields customer={customer} reps={reps} storedRep={storedRep} />
        <div style={{ display: 'flex', gap: SPACE.md }}>
          <Button>{saveLabel}</Button>
          <a
            href={`/crm/customers/${encodeURIComponent(id)}`}
            style={{ color: COLOR.accent, alignSelf: 'center' }}
          >
            Cancel
          </a>
        </div>
      </form>
    </PageShell>
  );
}

function BackLink({ id }: { id: string }) {
  return (
    <p style={{ marginBottom: SPACE.md }}>
      <a href={`/crm/customers/${encodeURIComponent(id)}`} style={{ color: COLOR.accent }}>
        ← Back to profile
      </a>
    </p>
  );
}

const formStyle = { display: 'grid', gap: SPACE.lg, marginTop: SPACE.xl } as const;
