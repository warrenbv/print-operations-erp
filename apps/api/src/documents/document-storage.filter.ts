// Turns a document storage failure into 503 `document-storage-unavailable` with a sentence a person can act on.
// The log line carries the storage path and the request path without its query string. Registered by apps/api/src/documents/documents.module.ts.
import { DocumentStorageError } from '@erp/documents';
import { type ArgumentsHost, Catch, ServiceUnavailableException } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import type { Request } from 'express';

@Catch(DocumentStorageError)
export class DocumentStorageFilter extends BaseExceptionFilter {
  override catch(err: DocumentStorageError, host: ArgumentsHost): void {
    const request = host.switchToHttp().getRequest<Request | undefined>();

    const url = request?.originalUrl ?? request?.url;
    console.error(
      JSON.stringify({
        kind: 'documents',
        event: 'document_storage_failed',
        operation: err.operation,
        code: err.code,
        systemCode: err.systemCode,
        storagePath: err.storagePath,
        method: request?.method,
        url: url?.split('?')[0],
        error: err.cause instanceof Error ? err.cause.message : err.message,
      }),
    );

    super.catch(
      new ServiceUnavailableException({
        reason: 'document-storage-unavailable',
        value: err.code,
        message:
          err.operation === 'put'
            ? 'the ERP could not write this document to its document storage. Tell IT: document storage.'
            : 'the ERP could not read this document from its document storage. Tell IT: document storage.',
      }),
      host,
    );
  }
}
