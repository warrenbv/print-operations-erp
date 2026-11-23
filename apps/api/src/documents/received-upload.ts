// Helpers for a document a customer sends, such as a PO: the upload shape, its file name and the error mapping.
import { DocumentTooLargeError, UnsupportedDocumentTypeError } from '@erp/documents';
import { PayloadTooLargeException, UnsupportedMediaTypeException } from '@nestjs/common';

export interface UploadedFile {
  originalname: string;
  mimetype: string;
  buffer: Buffer;
  size: number;
}

/**
 * Multipart file names arrive decoded as Latin-1. Re-reads them as UTF-8, and keeps the name as it came
 * when that produces a replacement character.
 */
export function decodeMultipartFilename(originalname: string): string {
  const utf8 = Buffer.from(originalname, 'latin1').toString('utf8');
  return utf8.includes('�') ? originalname : utf8;
}

export function mapDocumentsError(err: unknown): never {
  if (err instanceof UnsupportedDocumentTypeError) {
    throw new UnsupportedMediaTypeException({ reason: 'unsupported-document-type' });
  }

  if (err instanceof DocumentTooLargeError) {
    throw new PayloadTooLargeException({ reason: 'document-too-large' });
  }
  throw err;
}
