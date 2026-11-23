// Server action that asks the Billing Manager for a credit-hold exception: docs/product/requirements.md (R2).
// It is posted from New quote, a quote page or the customer page, and returns to the one that posted it.
// The Billing Manager decides it on Approvals, apps/web/src/app/approvals/page.tsx.
'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { optionalString, requireString } from '@erp/utils';

import { apiFetch } from '../../lib/api-fetch';
import { readableApiError } from '../../lib/api-error';
import { backWithError, noticeUrl } from '../../lib/redirect-error';

export async function requestCreditExceptionAction(formData: FormData): Promise<void> {
  const customerId = requireString(formData, 'customerId');

  const quoteId = optionalString(formData, 'quoteId');
  const q = optionalString(formData, 'q');

  const fromCustomer = optionalString(formData, 'from') === 'customer';
  const customerPage = `/crm/customers/${encodeURIComponent(customerId)}`;

  const back =
    quoteId !== undefined
      ? `/quoting/quotes/${encodeURIComponent(quoteId)}`
      : fromCustomer
        ? customerPage
        : '/quoting/quotes/new';

  const extra: Readonly<Record<string, string>> =
    back === '/quoting/quotes/new' && q !== undefined ? { q } : {};

  const reason = optionalString(formData, 'reason');
  if (reason === undefined) {
    backWithError(back, 'A reason is required to ask for a credit-hold exception.', extra);
  }

  const response = await apiFetch('/quoting/credit-approvals', {
    method: 'POST',
    body: JSON.stringify({ customerId, reason }),
  });
  if (!response.ok) {
    backWithError(back, await readableApiError('Could not ask for an exception', response), extra);
  }

  revalidatePath('/quoting/quotes/new');
  revalidatePath('/quoting/quotes');
  revalidatePath('/approvals');
  revalidatePath(customerPage);
  if (quoteId !== undefined) {
    revalidatePath(`/quoting/quotes/${quoteId}`);
  }

  redirect(
    noticeUrl(back, 'Exception requested. A Billing Manager decides it from Approvals.', extra),
  );
}
