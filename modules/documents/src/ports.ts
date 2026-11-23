// The ports the document service depends on and the errors it raises. The PDF engine is one adapter
// behind `DocumentRenderer`, and storage is a file store plus a record repository. See Document
// rendering in docs/decisions/README.md. The service: modules/documents/src/services/document-service.ts.
import type {
  DocumentKind,
  DocumentSource,
  DocumentStorageFailure,
  DocumentSubject,
  StoredDocument,
} from '@erp/types';

import type { DocumentModel } from './document-model';

export interface Clock {
  now(): Date;
}

export interface DocumentRenderer {
  render(model: DocumentModel): Promise<Uint8Array>;
}

/**
 * Holds document bytes at a relative storage path. `put` never overwrites: a second write to the same
 * path fails with `DocumentAlreadyStoredError`. Failures surface as `DocumentStorageError`, which the
 * API reports through apps/api/src/documents/document-storage.filter.ts.
 */
export interface DocumentStore {
  put(storagePath: string, bytes: Uint8Array): Promise<void>;
  read(storagePath: string): Promise<Uint8Array>;
  exists(storagePath: string): Promise<boolean>;
}

export class DocumentAlreadyStoredError extends Error {
  readonly storagePath: string;

  constructor(storagePath: string) {
    super(`a document is already stored at "${storagePath}" - refusing to overwrite`);
    this.name = 'DocumentAlreadyStoredError';
    this.storagePath = storagePath;
  }
}

export class DocumentStorageError extends Error {
  readonly operation: 'put' | 'read';
  readonly storagePath: string;
  readonly code: DocumentStorageFailure;
  readonly systemCode: string | undefined;

  constructor(
    operation: 'put' | 'read',
    storagePath: string,
    code: DocumentStorageFailure,
    systemCode: string | undefined,
    cause?: unknown,
  ) {
    super(
      `document storage could not ${operation === 'put' ? 'write' : 'read'} "${storagePath}": ${code}${
        systemCode === undefined ? '' : ` (${systemCode})`
      }`,
      cause === undefined ? undefined : { cause },
    );
    this.name = 'DocumentStorageError';
    this.operation = operation;
    this.storagePath = storagePath;
    this.code = code;
    this.systemCode = systemCode;
  }
}

export class StoredDocumentMissingError extends DocumentStorageError {
  constructor(storagePath: string, cause?: unknown) {
    super('read', storagePath, 'missing', 'ENOENT', cause);
    this.message = `no file at "${storagePath}" - the record and the store disagree`;
    this.name = 'StoredDocumentMissingError';
  }
}

/**
 * A generated document has no uploader and no original filename. A received one always has an
 * uploader. The CHECK constraints in infra/db/migrations/documents/0000_baseline.sql hold the table
 * to the same shape.
 */
export interface NewStoredDocument {
  id: string;
  kind: DocumentKind;
  subject: DocumentSubject;
  filename: string;
  storagePath: string;

  contentType: StoredDocument['contentType'];
  byteSize: number;
  checksumSha256: string;
  documentAt: Date;

  source: DocumentSource;

  uploadedBy: string | null;

  originalFilename: string | null;
}

export class UnsupportedDocumentTypeError extends Error {
  readonly declared: string;
  constructor(declared: string) {
    super(`received bytes are not an accepted document type (client declared "${declared}")`);
    this.name = 'UnsupportedDocumentTypeError';
    this.declared = declared;
  }
}

/** The cap is `RECEIVED_DOCUMENT_MAX_BYTES` in packages/types/src/document.ts. */
export class DocumentTooLargeError extends Error {
  readonly byteSize: number;
  constructor(byteSize: number) {
    super(`received document is ${byteSize} bytes, over the cap`);
    this.name = 'DocumentTooLargeError';
    this.byteSize = byteSize;
  }
}

export interface StoredDocumentRepository {
  record(document: NewStoredDocument): Promise<StoredDocument>;
  findById(id: string): Promise<StoredDocument | null>;

  /**
   * Newest first by `storedAt`, ties broken by id:
   * modules/documents/test/contracts/stored-document-repository.contract.ts.
   */
  listForSubject(subject: DocumentSubject): Promise<readonly StoredDocument[]>;
}

export class NoTemplateForKindError extends Error {
  readonly kind: string;
  readonly registered: readonly string[];

  constructor(kind: string, registered: readonly string[]) {
    super(
      registered.length === 0
        ? `no document template is registered (asked for "${kind}")`
        : `no template for document kind "${kind}" — registered: ${registered.join(', ')}`,
    );
    this.name = 'NoTemplateForKindError';
    this.kind = kind;
    this.registered = registered;
  }
}
