// Server actions for the customer's PO on an order: the PO number and the PO document: docs/product/requirements.md (R9).
'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { capturePurchaseOrderRequestSchema } from '@erp/types';
import { optionalString, requireString } from '@erp/utils';

import { apiFetch } from '../../../lib/api-fetch';
import { readableApiError } from '../../../lib/api-error';
import { backWithError, noticeUrl } from '../../../lib/redirect-error';
import { attachPoDocument, chosenFile } from './attach-po-document';

export async function capturePurchaseOrderAction(formData: FormData): Promise<void> {
  const orderId = requireString(formData, 'orderId');
  const poNumber = optionalString(formData, 'poNumber');

  const candidate = {
    ...(poNumber === undefined ? {} : { poNumber }),

    lockVersion: optionalString(formData, 'lockVersion') ?? '',

    // The shared schema requires `capturedBy`. This placeholder only lets the form parse and is not
    // sent. The API records who captured the PO from the session.
    capturedBy: 'pending-session',
  };
  const parsed = capturePurchaseOrderRequestSchema.safeParse(candidate);
  if (!parsed.success) {
    backWithError(
      `/orders/${encodeURIComponent(orderId)}`,
      'The PO number can be at most 64 characters.',
    );
  }

  const response = await apiFetch(`/orders/${encodeURIComponent(orderId)}/purchase-order`, {
    method: 'PUT',
    body: JSON.stringify({
      ...(parsed.data.poNumber === undefined ? {} : { poNumber: parsed.data.poNumber }),
      lockVersion: parsed.data.lockVersion,
    }),
  });
  if (!response.ok) {
    backWithError(
      `/orders/${encodeURIComponent(orderId)}`,
      await readableApiError('Recording the PO number failed', response),
    );
  }
  revalidatePath(`/orders/${orderId}`);
  redirect(`/orders/${orderId}`);
}

export async function uploadPurchaseOrderDocumentAction(formData: FormData): Promise<void> {
  const orderId = requireString(formData, 'orderId');
  const orderPath = `/orders/${encodeURIComponent(orderId)}`;

  const file = chosenFile(formData.get('file'));
  if (file === undefined) {
    backWithError(orderPath, 'Choose a file to attach.', { field: 'documents' });
  }
  const refusal = await attachPoDocument(orderId, file);
  if (refusal !== undefined) {
    backWithError(orderPath, refusal, { field: 'documents' });
  }
  revalidatePath(`/orders/${orderId}`);

  redirect(noticeUrl(orderPath, `Attached ${file.name}.`));
}
