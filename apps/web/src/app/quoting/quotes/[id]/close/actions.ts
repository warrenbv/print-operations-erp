// Server action that closes a quote as lost, sending the lockVersion the confirm page was drawn with:
// docs/decisions/006-optimistic-concurrency.md. The customer is not emailed.
'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { requireString } from '@erp/utils';

import { apiFetch } from '../../../../../lib/api-fetch';
import { readableApiError } from '../../../../../lib/api-error';
import { backWithError, noticeUrl } from '../../../../../lib/redirect-error';

export async function closeAsLostAction(formData: FormData): Promise<void> {
  const quoteId = requireString(formData, 'quoteId');
  const lockVersion = requireString(formData, 'lockVersion');
  const path = `/quoting/quotes/${encodeURIComponent(quoteId)}`;

  const response = await apiFetch(`${path}/transition`, {
    method: 'POST',
    body: JSON.stringify({ to: 'closed_lost', lockVersion }),
  });
  if (!response.ok) {
    backWithError(path, await readableApiError('Could not close the quote', response));
  }
  revalidatePath(path);
  redirect(noticeUrl(path, 'Quote closed as lost.'));
}
