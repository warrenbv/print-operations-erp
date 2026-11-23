// The size limit on a document a customer sends, such as a PO file, in megabytes and as a refusal sentence.
// The limit is RECEIVED_DOCUMENT_MAX_BYTES in packages/types/src/document.ts, which the API checks as well.
import { RECEIVED_DOCUMENT_MAX_BYTES } from '@erp/types';

const BYTES_PER_MB = 1024 * 1024;

export const RECEIVED_DOCUMENT_MAX_MB = RECEIVED_DOCUMENT_MAX_BYTES / BYTES_PER_MB;

export function receivedDocumentTooLarge(size: number): string | undefined {
  if (size <= RECEIVED_DOCUMENT_MAX_BYTES) {
    return undefined;
  }
  const megabytes = Math.ceil((size * 10) / BYTES_PER_MB) / 10;
  return (
    `That file is ${megabytes.toFixed(1)} MB, and the limit is ` +
    `${String(RECEIVED_DOCUMENT_MAX_MB)} MB. Save a smaller copy and attach it again.`
  );
}
