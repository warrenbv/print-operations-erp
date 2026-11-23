// Saves a customer's quote defaults and parts.
// After a validation error the typed values travel back in the URL and the form redraws as typed.
// After a 409 they do not, and the form redraws from the stored record: docs/decisions/006-optimistic-concurrency.md.
'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { apiFetch } from '../../../../../lib/api-fetch';
import { readableApiError } from '../../../../../lib/api-error';
import { echoOf } from '../../../../../lib/form-echo';
import { backWithError } from '../../../../../lib/redirect-error';
import { collectDefaults } from './collect-defaults';

export async function saveCustomerDefaultsAction(formData: FormData): Promise<void> {
  const customerId = formData.get('customerId');
  if (typeof customerId !== 'string' || customerId === '') {
    throw new Error('Missing form field: customerId');
  }
  const editPath = `/crm/customers/${encodeURIComponent(customerId)}/defaults/edit`;
  const drawnAt = formData.get('lockVersion');
  const withEcho = {
    ...echoOf(formData, (name) => name !== 'customerId' && name !== 'lockVersion'),
    ...(typeof drawnAt === 'string' ? { drawnAt } : {}),
  };

  const collected = collectDefaults(formData);
  if (!collected.ok) {
    backWithError(editPath, collected.message, withEcho);
  }

  const response = await apiFetch(`/crm/customers/${encodeURIComponent(customerId)}/defaults`, {
    method: 'PUT',
    body: JSON.stringify(collected.request),
  });
  if (!response.ok) {
    const message = await readableApiError('Could not save the defaults', response);
    backWithError(editPath, message, response.status === 409 ? {} : withEcho);
  }

  revalidatePath(`/crm/customers/${customerId}`);
  redirect(`/crm/customers/${encodeURIComponent(customerId)}`);
}
