// Sends a chosen PO file to the API. The size is checked here first with apps/web/src/lib/received-document.ts,
// so an oversized file gets a message without an upload.
import { apiFetch } from '../../../lib/api-fetch';
import { readableApiError } from '../../../lib/api-error';
import { receivedDocumentTooLarge } from '../../../lib/received-document';

export function chosenFile(entry: FormDataEntryValue | null): File | undefined {
  return entry instanceof File && entry.size > 0 ? entry : undefined;
}

export async function attachPoDocument(orderId: string, file: File): Promise<string | undefined> {
  const tooLarge = receivedDocumentTooLarge(file.size);
  if (tooLarge !== undefined) {
    return tooLarge;
  }

  const upload = new FormData();
  upload.append('file', file, file.name);

  const response = await apiFetch(
    `/orders/${encodeURIComponent(orderId)}/purchase-order/document`,
    { method: 'POST', body: upload },
  );
  if (!response.ok) {
    return readableApiError('Attaching the document failed', response);
  }
  return undefined;
}
