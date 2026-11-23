// Server actions that add, edit and remove a customer's contacts.
// Adding is an append and runs inside `withSubmissionToken`: apps/web/src/app/every-append-form-carries-a-token.test.ts.
// Edits and removals post the contact's `lockVersion`: docs/decisions/006-optimistic-concurrency.md.
'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { updateContactResponseSchema } from '@erp/types';
import { optionalString, requireString } from '@erp/utils';

import { apiFetch } from '../../../../../lib/api-fetch';
import { readableApiError } from '../../../../../lib/api-error';
import { rolesGivenUpNotice } from '../../../../../lib/contact-roles';
import { backWithError, noticeUrl } from '../../../../../lib/redirect-error';
import { SUBMISSION_TOKEN_FIELD, withSubmissionToken } from '../../../../../lib/submission-token';
import { collectCreate, collectDelete, collectUpdate } from './collect-contact';

const GONE = 'that contact is no longer there - someone may have removed it.';

export async function createContactAction(formData: FormData): Promise<void> {
  const customerId = requireString(formData, 'customerId');

  await withSubmissionToken(optionalString(formData, SUBMISSION_TOKEN_FIELD), async () => {
    const collected = collectCreate(formData);
    if (!collected.ok) {
      backToProfile(customerId, collected.message);
    }

    const response = await apiFetch(`/crm/customers/${encodeURIComponent(customerId)}/contacts`, {
      method: 'POST',
      body: JSON.stringify(collected.request),
    });
    if (!response.ok) {
      backToProfile(
        customerId,
        response.status === 404
          ? 'that customer is no longer there.'
          : await readableApiError('Could not add that contact', response),
      );
    }

    revalidateContacts(customerId);
    redirect(profilePath(customerId));
  });
}

export async function updateContactAction(formData: FormData): Promise<void> {
  const customerId = requireString(formData, 'customerId');
  const contactId = requireString(formData, 'contactId');

  const collected = collectUpdate(formData);
  if (!collected.ok) {
    backToEdit(customerId, contactId, collected.message);
  }

  const response = await apiFetch(contactPath(customerId, contactId), {
    method: 'PATCH',
    body: JSON.stringify(collected.request),
  });
  if (!response.ok) {
    backToEdit(
      customerId,
      contactId,
      response.status === 404
        ? GONE
        : await readableApiError('Could not save that contact', response),
    );
  }

  const saved = updateContactResponseSchema.safeParse(await response.json().catch(() => null));
  const givenUp = saved.success ? saved.data.rolesGivenUp : [];

  revalidateContacts(customerId);
  redirect(
    givenUp.length === 0
      ? profilePath(customerId)
      : noticeUrl(profilePath(customerId), rolesGivenUpNotice(givenUp)),
  );
}

export async function deleteContactAction(formData: FormData): Promise<void> {
  const customerId = requireString(formData, 'customerId');
  const contactId = requireString(formData, 'contactId');

  const collected = collectDelete(formData);
  if (!collected.ok) {
    backToRemove(customerId, contactId, collected.message);
  }

  const response = await apiFetch(contactPath(customerId, contactId), {
    method: 'DELETE',

    body: JSON.stringify(collected.request),
  });
  if (!response.ok) {
    backToRemove(
      customerId,
      contactId,
      response.status === 404
        ? GONE
        : await readableApiError('Could not remove that contact', response),
    );
  }

  revalidateContacts(customerId);
  redirect(profilePath(customerId));
}

function profilePath(customerId: string): string {
  return `/crm/customers/${encodeURIComponent(customerId)}`;
}

function contactPath(customerId: string, contactId: string): string {
  return `${profilePath(customerId)}/contacts/${encodeURIComponent(contactId)}`;
}

function revalidateContacts(customerId: string): void {
  revalidatePath(profilePath(customerId));
}

function backToProfile(customerId: string, message: string): never {
  backWithError(profilePath(customerId), message);
}

function backToEdit(customerId: string, contactId: string, message: string): never {
  backWithError(`${contactPath(customerId, contactId)}/edit`, message);
}

function backToRemove(customerId: string, contactId: string, message: string): never {
  backWithError(`${contactPath(customerId, contactId)}/remove`, message);
}
