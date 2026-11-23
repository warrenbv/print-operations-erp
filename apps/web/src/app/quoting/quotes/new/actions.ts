// Server action that starts a draft quote for the chosen customer: docs/product/requirements.md (R1).
// The API refuses a customer on credit hold unless an approved exception is spent on this quote:
// docs/product/requirements.md (R2), modules/quoting/src/services/quote-service.ts.
'use server';

import { redirect } from 'next/navigation';

import { quoteSchema } from '@erp/types';
import { optionalString } from '@erp/utils';

import { apiFetch } from '../../../../lib/api-fetch';
import { readableApiError } from '../../../../lib/api-error';
import { backWithError } from '../../../../lib/redirect-error';

export async function createQuoteAction(formData: FormData): Promise<void> {
  const customerId = formData.get('customerId');
  if (typeof customerId !== 'string' || customerId === '') {
    throw new Error('Missing form field: customerId');
  }
  const q = optionalString(formData, 'q');
  const fromCustomer = optionalString(formData, 'from') === 'customer';
  const salesRep = optionalString(formData, 'salesRep');
  const notes = optionalString(formData, 'notes');

  const response = await apiFetch('/quoting/quotes', {
    method: 'POST',
    body: JSON.stringify({
      customerId,
      ...(salesRep === undefined ? {} : { salesRep }),
      ...(notes === undefined ? {} : { notes }),
    }),
  });
  if (!response.ok) {
    const message = await readableApiError('Could not start the quote', response);
    if (fromCustomer) {
      backWithError(`/crm/customers/${encodeURIComponent(customerId)}`, message);
    }

    backWithError('/quoting/quotes/new', message, q === undefined ? {} : { q });
  }
  const quote = quoteSchema.parse(await response.json());
  redirect(`/quoting/quotes/${quote.id}`);
}
