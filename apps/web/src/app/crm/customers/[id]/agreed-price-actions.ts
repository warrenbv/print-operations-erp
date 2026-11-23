// Saves or removes the agreed price on one customer part. A quote line at that price needs no price approval.
// The API decides who may. The page offers it to the roles in `maySetAgreedPrice`, apps/web/src/lib/roles.ts.
'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { apiFetch } from '../../../../lib/api-fetch';
import { readableApiError } from '../../../../lib/api-error';
import { backWithError, noticeUrl } from '../../../../lib/redirect-error';
import { collectSetAgreedPrice } from './agreed-price';

export async function setAgreedPriceAction(formData: FormData): Promise<void> {
  const collected = collectSetAgreedPrice(formData);
  if (!collected.ok) {
    const customerId = formData.get('customerId');
    backWithError(
      typeof customerId === 'string' && customerId !== ''
        ? `/crm/customers/${encodeURIComponent(customerId)}`
        : '/crm/customers',
      collected.message,
    );
  }

  const { customerId, request } = collected;
  const profile = `/crm/customers/${encodeURIComponent(customerId)}`;
  const route = `/crm/customers/${encodeURIComponent(customerId)}/parts/agreed-price`;

  const response = await apiFetch(route, {
    method: 'PUT',
    body: JSON.stringify(request),
  });
  const removing = request.agreedPrice === null;
  if (!response.ok) {
    backWithError(
      profile,
      await readableApiError(
        removing ? 'Could not remove the agreed price' : 'Could not save the agreed price',
        response,
      ),
    );
  }

  revalidatePath(profile);
  redirect(
    noticeUrl(
      profile,
      removing
        ? 'Agreed price removed.'
        : 'Agreed price saved. A quote line at that price needs no approval.',
    ),
  );
}
