// In-memory adapter for `StoredDocumentRepository`, used by the demo and by tests. It meets the same
// contract as the PostgreSQL adapter: modules/documents/test/contracts/stored-document-repository.contract.ts.
import type { DocumentSubject, StoredDocument } from '@erp/types';

import type { Clock, NewStoredDocument, StoredDocumentRepository } from '../../ports';

export class InMemoryStoredDocumentRepository implements StoredDocumentRepository {
  readonly #rows = new Map<string, StoredDocument>();
  readonly #clock: Clock;

  constructor(clock: Clock) {
    this.#clock = clock;
  }

  async record(document: NewStoredDocument): Promise<StoredDocument> {
    // These checks mirror the table's primary key and unique storage-path index, so both adapters
    // refuse the same inputs.
    if (this.#rows.has(document.id)) {
      throw new Error(`stored document ${document.id} already recorded`);
    }
    for (const existing of this.#rows.values()) {
      if (existing.storagePath === document.storagePath) {
        throw new Error(`storage path "${document.storagePath}" already recorded`);
      }
    }

    const stored: StoredDocument = {
      id: document.id,
      kind: document.kind,
      subject: { ...document.subject },
      filename: document.filename,
      storagePath: document.storagePath,
      contentType: document.contentType,
      byteSize: document.byteSize,
      checksumSha256: document.checksumSha256,
      documentAt: document.documentAt.toISOString(),
      storedAt: this.#clock.now().toISOString(),
      source: document.source,
      uploadedBy: document.uploadedBy,
      originalFilename: document.originalFilename,
    };
    this.#rows.set(stored.id, stored);
    return stored;
  }

  async findById(id: string): Promise<StoredDocument | null> {
    return this.#rows.get(id) ?? null;
  }

  async listForSubject(subject: DocumentSubject): Promise<readonly StoredDocument[]> {
    return [...this.#rows.values()]
      .filter((d) => d.subject.type === subject.type && d.subject.id === subject.id)
      .sort((a, b) => {
        const byTime = b.storedAt.localeCompare(a.storedAt);
        return byTime !== 0 ? byTime : b.id.localeCompare(a.id);
      });
  }
}
