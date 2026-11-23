// Public surface of the documents module, wired by apps/api/src/documents/documents.factory.ts.
export { DocumentService } from './services/document-service';

export {
  DocumentStorageError,
  DocumentTooLargeError,
  UnsupportedDocumentTypeError,
  type DocumentStore,
  type StoredDocumentRepository,
} from './ports';

export { LocalFileDocumentStore } from './adapters/local-file/local-file-document-store';
export { InMemoryDocumentStore } from './adapters/in-memory/in-memory-document-store';

export { DrizzleStoredDocumentRepository } from './adapters/drizzle/drizzle-stored-document-repository';
export { InMemoryStoredDocumentRepository } from './adapters/in-memory/in-memory-stored-document-repository';

export { createDocumentsDb } from './data/documents-db';

export { buildQuoteDocument } from './templates/quote-document';

export { buildOrderConfirmationDocument } from './templates/order-confirmation-document';

export { DEMO_BRAND } from './brands';

export { ReactPdfDocumentRenderer } from './adapters/react-pdf/react-pdf-renderer';
export { systemClock } from './adapters/system-clock';
