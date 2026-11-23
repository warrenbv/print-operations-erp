// Places or lifts a customer's credit hold. A held account cannot have a new quote created until an
// exception is approved: docs/product/requirements.md (R2). Only the Billing Manager or an Admin may, and the API enforces it.
// The form posts the customer's `lockVersion`: docs/decisions/006-optimistic-concurrency.md.
'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { apiFetch } from '../../../../lib/api-fetch';
import { readableApiError } from '../../../../lib/api-error';
import { backWithError, noticeUrl } from '../../../../lib/redirect-error';
import { collectSetCreditHold } from './credit-hold';

export async function setCreditHoldAction(formData: FormData): Promise<void> {
  const collected = collectSetCreditHold(formData);
  if (!collected.ok) {
    backWithError('/crm/customers', collected.message);
  }

  const { customerId, request } = collected;

  const profile = `/crm/customers/${encodeURIComponent(customerId)}`;
  const route = `/crm/customers/${encodeURIComponent(customerId)}/credit-hold`;

  const response = await apiFetch(route, {
    method: 'PUT',
    body: JSON.stringify(request),
  });
  if (!response.ok) {
    backWithError(
      profile,
      await readableApiError(
        request.held ? 'Could not place that account on hold' : 'Could not lift that hold',
        response,
      ),
    );
  }

  revalidatePath('/crm/customers');
  revalidatePath(profile);

  redirect(
    noticeUrl(
      profile,
      request.held
        ? 'Account placed on credit hold. No quote can be raised for it.'
        : 'Credit hold lifted. Quotes can be raised for this account again.',
    ),
  );
}
