// Server actions that create and update a customer.
// Creating is an append, so it runs inside `withSubmissionToken`: apps/web/src/app/every-append-form-carries-a-token.test.ts.
// Opened from New quote, the form also adds the contact the quote is emailed to and returns there:
// docs/product/requirements.md (R1).
'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { customerSchema, type CreateContactRequest } from '@erp/types';
import { optionalString, requireString } from '@erp/utils';

import { apiFetch } from '../../../lib/api-fetch';
import { readableApiError } from '../../../lib/api-error';
import { echoOf } from '../../../lib/form-echo';
import { backWithError, noticeUrl } from '../../../lib/redirect-error';
import { RETURN_TO_FIELD, resolveReturnTo } from '../../../lib/return-to';
import { SUBMISSION_TOKEN_FIELD, withSubmissionToken } from '../../../lib/submission-token';
import { collectCreate, collectForQuote, collectUpdate } from './collect-customer';

export async function createCustomerAction(formData: FormData): Promise<void> {
  const returnTo = resolveReturnTo(optionalString(formData, RETURN_TO_FIELD));

  await withSubmissionToken(optionalString(formData, SUBMISSION_TOKEN_FIELD), async () => {
    const collected = collectCreate(formData);
    if (!collected.ok) {
      backToNew(formData, returnTo, collected.message);
    }

    let contact: CreateContactRequest | undefined;
    if (returnTo !== undefined) {
      const forQuote = collectForQuote(formData, collected.request);
      if (!forQuote.ok) {
        backToNew(formData, returnTo, forQuote.message);
      }
      contact = forQuote.request;
    }

    const response = await apiFetch('/crm/customers', {
      method: 'POST',
      body: JSON.stringify(collected.request),
    });
    if (!response.ok) {
      backToNew(
        formData,
        returnTo,
        await readableApiError('Could not add that customer', response),
      );
    }

    const created = customerSchema.parse(await response.json());
    revalidatePath('/crm/customers');

    if (contact === undefined || returnTo === undefined) {
      redirect(`/crm/customers/${encodeURIComponent(created.id)}`);
    }

    // The customer and its first contact are two API calls. If the second fails, the customer
    // stays and the message says so.
    const profile = `/crm/customers/${encodeURIComponent(created.id)}`;

    const added = await apiFetch(`${profile}/contacts`, {
      method: 'POST',
      body: JSON.stringify(contact),
    });
    if (!added.ok) {
      backWithError(
        profile,
        `The customer was saved and the contact was not. ${await readableApiError(
          'Could not add the contact',
          added,
        )} Add the contact here, then start the quote.`,
      );
    }

    revalidatePath(profile);

    redirect(
      noticeUrl(returnTo, 'Customer added. Start the quote from their row.', { q: created.name }),
    );
  });
}

export async function updateCustomerAction(formData: FormData): Promise<void> {
  const customerId = requireString(formData, 'customerId');

  const collected = collectUpdate(formData);
  if (!collected.ok) {
    backToEdit(customerId, collected.message);
  }

  const response = await apiFetch(`/crm/customers/${encodeURIComponent(customerId)}`, {
    method: 'PATCH',
    body: JSON.stringify(collected.request),
  });
  if (!response.ok) {
    backToEdit(customerId, await readableApiError('Could not save that customer', response));
  }

  revalidatePath('/crm/customers');
  revalidatePath(`/crm/customers/${customerId}`);
  redirect(`/crm/customers/${encodeURIComponent(customerId)}`);
}

function backToNew(formData: FormData, returnTo: string | undefined, message: string): never {
  backWithError('/crm/customers/new', message, {
    ...(returnTo === undefined ? {} : { [RETURN_TO_FIELD]: returnTo }),
    ...echoOf(formData, (name) => name !== SUBMISSION_TOKEN_FIELD && name !== RETURN_TO_FIELD),
  });
}

function backToEdit(customerId: string, message: string): never {
  backWithError(`/crm/customers/${encodeURIComponent(customerId)}/edit`, message);
}
