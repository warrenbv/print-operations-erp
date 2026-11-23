// Renders a document model to a PDF, stores generated and received documents, and lists them for a
// quote or an order. Callers: apps/api/src/quoting/quotes.controller.ts (the quote PDF) and
// apps/api/src/orders/orders.controller.ts (the order confirmation, and the customer's PO document
// that docs/product/requirements.md (R9) lets an order record).
import { newId } from '@erp/db';
import type {
  DocumentKind,
  DocumentSubject,
  ReceivedContentType,
  RenderedDocument,
  StoredDocument,
} from '@erp/types';
import { RECEIVED_DOCUMENT_MAX_BYTES } from '@erp/types';
import { checksumOf, documentStoragePath } from '../adapters/local-file/local-file-document-store';
import type { DocumentModel } from '../document-model';
import { identifyReceivedBytes } from '../magic-bytes';
import {
  type Clock,
  DocumentTooLargeError,
  type DocumentRenderer,
  type DocumentStore,
  NoTemplateForKindError,
  type StoredDocumentRepository,
  UnsupportedDocumentTypeError,
} from '../ports';

interface DocumentServiceOptions {
  renderer: DocumentRenderer;
  clock: Clock;

  supportedKinds?: readonly DocumentKind[];

  store?: DocumentStore;
  documents?: StoredDocumentRepository;
}

// The API registers both templates: apps/api/src/documents/documents.factory.ts.
const DEFAULT_SUPPORTED: readonly DocumentKind[] = ['quote'];

export function documentFilename(kind: DocumentKind, reference: string, at: Date): string {
  const date = at.toISOString().slice(0, 10).replace(/-/g, '');
  const safeReference = reference.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-|-$/g, '');
  return `${kind.replace(/_/g, '-')}-${safeReference}-${date}.pdf`;
}

// The stored name uses safe characters and the extension of the detected type, never the extension
// the sender gave.
function receivedFilename(original: string, contentType: ReceivedContentType): string {
  const base = original
    .replace(/\.[A-Za-z0-9]{1,8}$/, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/\.{2,}/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 96);
  const stem = base === '' ? 'document' : base;
  return `${stem}${RECEIVED_EXTENSIONS[contentType]}`;
}

function originalFilename(sent: string): string | null {
  const cleaned = sent
    .replace(/[\r\n\u0000]/g, '')
    .trim()
    .slice(0, 255);
  return cleaned === '' ? null : cleaned;
}

const RECEIVED_EXTENSIONS: Record<ReceivedContentType, string> = {
  'application/pdf': '.pdf',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/tiff': '.tif',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
};

export class DocumentService {
  readonly #renderer: DocumentRenderer;
  readonly #clock: Clock;
  readonly #supported: readonly DocumentKind[];
  readonly #store: DocumentStore | undefined;
  readonly #documents: StoredDocumentRepository | undefined;

  constructor(options: DocumentServiceOptions) {
    this.#renderer = options.renderer;
    this.#clock = options.clock;
    this.#supported = options.supportedKinds ?? DEFAULT_SUPPORTED;
    // A service without storage can still render. Half of the storage pair is refused here, so the
    // mistake shows at construction and not on the first store.
    if ((options.store === undefined) !== (options.documents === undefined)) {
      throw new Error(
        'DocumentService needs both `store` and `documents` to store, or neither to render only',
      );
    }
    this.#store = options.store;
    this.#documents = options.documents;
  }

  async render(
    kind: DocumentKind,
    reference: string,
    model: DocumentModel,
  ): Promise<RenderedDocument> {
    if (!this.#supported.includes(kind)) {
      throw new NoTemplateForKindError(kind, this.#supported);
    }
    const at = this.#clock.now();
    const bytes = await this.#renderer.render(model);
    return {
      kind,
      filename: documentFilename(kind, reference, at),
      contentType: 'application/pdf',
      bytes,
      generatedAt: at.toISOString(),
    };
  }

  async renderAndStore(
    kind: DocumentKind,
    reference: string,
    subject: DocumentSubject,
    model: DocumentModel,
  ): Promise<StoredDocument> {
    const store = this.#store;
    const documents = this.#documents;
    if (store === undefined || documents === undefined) {
      throw new Error('this DocumentService was constructed without storage');
    }

    const rendered = await this.render(kind, reference, model);
    const id = newId();

    const documentAt = new Date(rendered.generatedAt);
    const storagePath = documentStoragePath(kind, id, rendered.filename, documentAt);

    // The file is written before its row. A failed write leaves no row pointing at nothing.
    await store.put(storagePath, rendered.bytes);

    return documents.record({
      id,
      kind,
      subject,
      filename: rendered.filename,
      storagePath,
      byteSize: rendered.bytes.byteLength,

      checksumSha256: checksumOf(rendered.bytes),
      contentType: rendered.contentType,
      documentAt,
      source: 'generated',

      uploadedBy: null,
      originalFilename: null,
    });
  }

  /**
   * Stores a document a customer sent, such as a PO, as opaque bytes. Refuses with
   * `DocumentTooLargeError` over the size cap and `UnsupportedDocumentTypeError` when the bytes match
   * no accepted type, both before anything is written. The name the sender gave is kept apart in
   * `originalFilename`.
   */
  async storeReceived(input: {
    kind: DocumentKind;
    subject: DocumentSubject;

    filename: string;
    declaredContentType: string;
    bytes: Uint8Array;

    uploadedBy: string;

    receivedAt?: Date;
  }): Promise<StoredDocument> {
    const store = this.#store;
    const documents = this.#documents;
    if (store === undefined || documents === undefined) {
      throw new Error('this DocumentService was constructed without storage');
    }

    if (input.bytes.byteLength > RECEIVED_DOCUMENT_MAX_BYTES) {
      throw new DocumentTooLargeError(input.bytes.byteLength);
    }

    const contentType = identifyReceivedBytes(input.bytes, input.declaredContentType);
    if (contentType === null) {
      throw new UnsupportedDocumentTypeError(input.declaredContentType);
    }

    const documentAt = input.receivedAt ?? this.#clock.now();
    const id = newId();

    const filename = receivedFilename(input.filename, contentType);
    const storagePath = documentStoragePath(input.kind, id, filename, documentAt);

    await store.put(storagePath, input.bytes);

    return documents.record({
      id,
      kind: input.kind,
      subject: input.subject,
      filename,
      storagePath,
      contentType,
      byteSize: input.bytes.byteLength,
      checksumSha256: checksumOf(input.bytes),
      documentAt,
      source: 'received',
      uploadedBy: input.uploadedBy,

      originalFilename: originalFilename(input.filename),
    });
  }

  async read(document: StoredDocument): Promise<Uint8Array> {
    if (this.#store === undefined) {
      throw new Error('this DocumentService was constructed without storage');
    }
    return this.#store.read(document.storagePath);
  }

  async listForSubject(subject: DocumentSubject): Promise<readonly StoredDocument[]> {
    if (this.#documents === undefined) {
      throw new Error('this DocumentService was constructed without storage');
    }
    return this.#documents.listForSubject(subject);
  }
}
