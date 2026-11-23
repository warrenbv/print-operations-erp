// The documents module's own PostgreSQL schema. The migration is generated from this file into
// infra/db/migrations/documents. The CHECK constraints that hold the text columns to the values in
// packages/types/src/document.ts are hand-written at the end of that baseline.
import { index, integer, pgSchema, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

export const documentsSchema = pgSchema('documents');

export const storedDocuments = documentsSchema.table(
  'stored_documents',
  {
    id: uuid('id').primaryKey(),

    kind: text('kind').notNull(),

    // The quote or order this document belongs to. It is held without a foreign key because those
    // tables live in other modules' schemas: docs/decisions/010-orm-spike.md.
    subjectType: text('subject_type').notNull(),
    subjectId: uuid('subject_id').notNull(),
    filename: text('filename').notNull(),

    storagePath: text('storage_path').notNull(),
    contentType: text('content_type').notNull(),
    byteSize: integer('byte_size').notNull(),
    checksumSha256: text('checksum_sha256').notNull(),

    documentAt: timestamp('document_at', { withTimezone: true }).notNull(),
    storedAt: timestamp('stored_at', { withTimezone: true }).notNull().defaultNow(),

    source: text('source').notNull().default('generated'),

    uploadedBy: text('uploaded_by'),

    originalFilename: text('original_filename'),
  },
  (table) => [
    uniqueIndex('stored_documents_storage_path_unique').on(table.storagePath),

    index('stored_documents_subject_idx').on(table.subjectType, table.subjectId, table.storedAt),

    index('stored_documents_kind_stored_at_idx').on(table.kind, table.storedAt),
  ],
);
