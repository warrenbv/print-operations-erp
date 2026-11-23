// Server actions for the Approvals page: credit-hold exceptions, hand-set prices and floor overrides.
// A price or floor decision posts the `lockVersion` the decider was shown, so the API refuses it if the
// quote changed meanwhile: docs/decisions/006-optimistic-concurrency.md.
// The API decides who may act. The page only hides the forms from those who may not.
'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { optionalString, requireString } from '@erp/utils';

import { apiFetch } from '../../lib/api-fetch';
import { readableApiError } from '../../lib/api-error';
import { backWithError, noticeUrl } from '../../lib/redirect-error';

// An approved exception permits one quote and leaves the hold on: docs/product/requirements.md (R2).
export async function approveCreditHoldAction(form: FormData): Promise<void> {
  const approvalId = requireString(form, 'approvalId');

  const response = await apiFetch(`/quoting/credit-approvals/${approvalId}/decision`, {
    method: 'POST',
    body: JSON.stringify({ decision: 'approved' }),
  });
  if (!response.ok) {
    backWithError('/approvals', await readableApiError('Approval failed', response));
  }

  revalidatePath('/approvals');
  redirect('/approvals');
}

export async function rejectCreditHoldAction(form: FormData): Promise<void> {
  const approvalId = requireString(form, 'approvalId');
  const reason = optionalString(form, 'reason');
  if (reason === undefined) {
    backWithError('/approvals', 'A reason is required to reject a credit-hold request.');
  }

  const response = await apiFetch(`/quoting/credit-approvals/${approvalId}/decision`, {
    method: 'POST',
    body: JSON.stringify({ decision: 'rejected', reason }),
  });
  if (!response.ok) {
    backWithError('/approvals', await readableApiError('Rejection failed', response));
  }

  revalidatePath('/approvals');
  redirect('/approvals');
}

// The Billing Manager's approval of a hand-set price: docs/product/requirements.md (R7).
export async function approveOverrideAction(formData: FormData): Promise<void> {
  const quoteId = requireString(formData, 'quoteId');
  const lockVersion = requireString(formData, 'lockVersion');

  const note = optionalString(formData, 'reason');

  const response = await apiFetch(
    `/quoting/quotes/${encodeURIComponent(quoteId)}/override/approve`,
    {
      method: 'POST',
      body: JSON.stringify({ lockVersion, ...(note === undefined ? {} : { reason: note }) }),
    },
  );
  if (!response.ok) {
    backWithError('/approvals', await readableApiError('Approval failed', response));
  }

  const review = `/quoting/quotes/${encodeURIComponent(quoteId)}/review`;
  revalidatePath('/approvals');
  revalidatePath(`/quoting/quotes/${quoteId}`);
  revalidatePath(review);
  redirect(noticeUrl(review, 'Price approved.'));
}

export async function rejectOverrideAction(formData: FormData): Promise<void> {
  const quoteId = requireString(formData, 'quoteId');
  const lockVersion = requireString(formData, 'lockVersion');
  const reason = optionalString(formData, 'reason');

  if (reason === undefined) {
    backWithError(
      '/approvals',
      'A rejection needs a reason — it is the only part of the decision the salesperson can act on.',
    );
  }

  const response = await apiFetch(
    `/quoting/quotes/${encodeURIComponent(quoteId)}/override/reject`,
    {
      method: 'POST',
      body: JSON.stringify({ reason, lockVersion }),
    },
  );
  if (!response.ok) {
    backWithError('/approvals', await readableApiError('Rejection failed', response));
  }

  revalidatePath('/approvals');
  revalidatePath(`/quoting/quotes/${quoteId}`);
  redirect('/approvals');
}

// An Admin's override of the floor on one quote, with the reason recorded: docs/product/requirements.md (R6).
export async function approveFloorOverrideAction(formData: FormData): Promise<void> {
  const quoteId = requireString(formData, 'quoteId');
  const lockVersion = requireString(formData, 'lockVersion');
  const reason = optionalString(formData, 'reason');

  if (reason === undefined) {
    backWithError(
      '/approvals',
      'Approving below the floor needs a reason. It is kept on the quote.',
    );
  }

  const response = await apiFetch(
    `/quoting/quotes/${encodeURIComponent(quoteId)}/floor-override/approve`,
    {
      method: 'POST',
      body: JSON.stringify({ reason, lockVersion }),
    },
  );
  if (!response.ok) {
    backWithError('/approvals', await readableApiError('Approval failed', response));
  }

  revalidatePath('/approvals');
  revalidatePath(`/quoting/quotes/${quoteId}`);
  redirect('/approvals');
}

export async function rejectFloorOverrideAction(formData: FormData): Promise<void> {
  const quoteId = requireString(formData, 'quoteId');
  const lockVersion = requireString(formData, 'lockVersion');
  const reason = optionalString(formData, 'reason');

  if (reason === undefined) {
    backWithError(
      '/approvals',
      'A rejection needs a reason — it is the only part of the decision the salesperson can act on.',
    );
  }

  const response = await apiFetch(
    `/quoting/quotes/${encodeURIComponent(quoteId)}/floor-override/reject`,
    {
      method: 'POST',
      body: JSON.stringify({ reason, lockVersion }),
    },
  );
  if (!response.ok) {
    backWithError('/approvals', await readableApiError('Rejection failed', response));
  }

  revalidatePath('/approvals');
  revalidatePath(`/quoting/quotes/${quoteId}`);
  redirect('/approvals');
}
