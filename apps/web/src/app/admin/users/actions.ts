// Saves one user's roles. The API accepts it from an Admin only: docs/product/roles.md.
// The form sends the user's directory identity with the roles, because accounts live in the company
// directory and the ERP only assigns roles to them.
'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { ERP_ROLES, type ErpRole } from '@erp/types';
import { optionalString, requireString } from '@erp/utils';

import { apiFetch } from '../../../lib/api-fetch';
import { readableApiError } from '../../../lib/api-error';
import { backWithError, noticeUrl } from '../../../lib/redirect-error';

export async function setRolesAction(formData: FormData): Promise<void> {
  const externalId = requireString(formData, 'externalId');
  const username = requireString(formData, 'username');
  const displayName = requireString(formData, 'displayName');

  const q = optionalString(formData, 'q');
  const emailRaw = formData.get('email');
  const email = typeof emailRaw === 'string' && emailRaw !== '' ? emailRaw : undefined;

  const submittedRoles = formData.getAll('roles').filter((v): v is string => typeof v === 'string');
  const roles: ErpRole[] = submittedRoles.filter((r): r is ErpRole =>
    (ERP_ROLES as readonly string[]).includes(r),
  );

  const response = await apiFetch(`/admin/users/${encodeURIComponent(externalId)}/roles`, {
    method: 'PUT',
    body: JSON.stringify({
      identity: { externalId, username, displayName, ...(email === undefined ? {} : { email }) },
      roles,
    }),
  });
  if (!response.ok) {
    backWithError(
      '/admin/users',
      await readableApiError('Role assignment failed', response),
      q === undefined ? {} : { q },
    );
  }
  revalidatePath('/admin/users');

  redirect(noticeUrl('/admin/users', 'Roles saved.', q === undefined ? {} : { q }));
}
