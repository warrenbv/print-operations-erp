// Server actions on an order page: confirming the order and emailing the order confirmation.
// Confirming commits the lead time. Production, the Production Manager or an Admin may, and the API
// enforces it: docs/product/requirements.md (R11). The form posts the order's `lockVersion`.
'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { confirmationIssuedResponseSchema, orderSchema } from '@erp/types';
import { requireString } from '@erp/utils';

import { apiFetch } from '../../../lib/api-fetch';
import { readableApiError } from '../../../lib/api-error';
import { confirmRecipientsBody } from '../../../lib/confirm-recipients';
import { backWithError, noticeUrl } from '../../../lib/redirect-error';
import { redirectNote } from '../../../lib/redirect-note';
import { toConfirmRequest } from './confirm-request';

export async function confirmOrderAction(formData: FormData): Promise<void> {
  const orderId = requireString(formData, 'orderId');
  const path = `/orders/${encodeURIComponent(orderId)}`;

  const outcome = toConfirmRequest({
    confirmedLeadTimeDays: String(formData.get('confirmedLeadTimeDays') ?? ''),
    lockVersion: String(formData.get('lockVersion') ?? ''),
  });
  if (!outcome.ok) {
    backWithError(
      path,
      outcome.message,
      outcome.field === undefined ? {} : { field: outcome.field },
    );
  }

  const response = await apiFetch(`${path}/confirm`, {
    method: 'POST',
    body: JSON.stringify(outcome.request),
  });
  if (!response.ok) {
    backWithError(path, await readableApiError('Confirming the order failed', response));
  }

  const confirmed = orderSchema.parse(await response.json());
  revalidatePath(path);
  revalidatePath('/orders');
  redirect(
    noticeUrl(
      path,
      confirmed.jobNumber === undefined
        ? 'Order confirmed.'
        : `Order confirmed. Job number ${confirmed.jobNumber}.`,
    ),
  );
}

export async function issueOrderConfirmationAction(formData: FormData): Promise<void> {
  const orderId = requireString(formData, 'orderId');

  const confirmation = confirmRecipientsBody(formData);
  const path = `/orders/${encodeURIComponent(orderId)}`;

  const response = await apiFetch(`${path}/confirmation`, {
    method: 'POST',
    body: JSON.stringify(confirmation),
  });
  if (!response.ok) {
    backWithError(path, await readableApiError('Could not send the order confirmation', response));
  }

  const issued = confirmationIssuedResponseSchema.parse(await response.json());
  revalidatePath(path);
  redirect(
    noticeUrl(
      path,
      issued.recipients.length === 0
        ? 'Order confirmation issued.'
        : `Order confirmation emailed to ${issued.recipients.join(', ')}${redirectNote(issued.redirectedTo)}.`,
    ),
  );
}
