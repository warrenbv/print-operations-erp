// PostgreSQL adapter for `StoredDocumentRepository`. It meets the same contract as the in-memory
// adapter: modules/documents/test/contracts/stored-document-repository.contract.ts.
import type {
  DocumentKind,
  DocumentSubject,
  DocumentSubjectType,
  StoredDocument,
} from '@erp/types';
import { and, desc, eq } from 'drizzle-orm';

import type { DocumentsDb } from '../../data/documents-db';
import { storedDocuments } from '../../data/schema';
import type { NewStoredDocument, StoredDocumentRepository } from '../../ports';

type StoredDocumentRow = typeof storedDocuments.$inferSelect;

function toStoredDocument(row: StoredDocumentRow): StoredDocument {
  return {
    id: row.id,
    kind: row.kind as DocumentKind,
    subject: { type: row.subjectType as DocumentSubjectType, id: row.subjectId },
    filename: row.filename,
    storagePath: row.storagePath,

    contentType: row.contentType as StoredDocument['contentType'],
    byteSize: row.byteSize,
    checksumSha256: row.checksumSha256,
    documentAt: row.documentAt.toISOString(),
    storedAt: row.storedAt.toISOString(),
    source: row.source as StoredDocument['source'],
    uploadedBy: row.uploadedBy,
    originalFilename: row.originalFilename,
  };
}

export class DrizzleStoredDocumentRepository implements StoredDocumentRepository {
  readonly #db: DocumentsDb;

  constructor(db: DocumentsDb) {
    this.#db = db;
  }

  async record(document: NewStoredDocument): Promise<StoredDocument> {
    const [row] = await this.#db
      .insert(storedDocuments)
      .values({
        id: document.id,
        kind: document.kind,
        subjectType: document.subject.type,
        subjectId: document.subject.id,
        filename: document.filename,
        storagePath: document.storagePath,

        contentType: document.contentType,
        byteSize: document.byteSize,
        checksumSha256: document.checksumSha256,
        documentAt: document.documentAt,
        source: document.source,
        uploadedBy: document.uploadedBy,
        originalFilename: document.originalFilename,
      })
      .returning();

    if (row === undefined) throw new Error('insert returned no row');
    return toStoredDocument(row);
  }

  async findById(id: string): Promise<StoredDocument | null> {
    const [row] = await this.#db.select().from(storedDocuments).where(eq(storedDocuments.id, id));
    return row === undefined ? null : toStoredDocument(row);
  }

  async listForSubject(subject: DocumentSubject): Promise<readonly StoredDocument[]> {
    const rows = await this.#db
      .select()
      .from(storedDocuments)
      .where(
        and(
          eq(storedDocuments.subjectType, subject.type),
          eq(storedDocuments.subjectId, subject.id),
        ),
      )

      .orderBy(desc(storedDocuments.storedAt), desc(storedDocuments.id));
    return rows.map(toStoredDocument);
  }
}
