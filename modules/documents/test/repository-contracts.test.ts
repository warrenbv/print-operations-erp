// Runs the stored-document contract against the in-memory adapter, and against PostgreSQL when
// `DATABASE_URL` is set (`pnpm test:db`). Also checks that the baseline's CHECK constraints refuse a
// kind or subject type the module does not have.
import { resolve } from 'node:path';

import { moduleTestDatabase, newId } from '@erp/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DrizzleStoredDocumentRepository } from '../src/adapters/drizzle/drizzle-stored-document-repository';
import { InMemoryStoredDocumentRepository } from '../src/adapters/in-memory/in-memory-stored-document-repository';
import { systemClock } from '../src/adapters/system-clock';
import { createDocumentsDb } from '../src/data/documents-db';
import type { StoredDocumentRepository } from '../src/ports';
import { storedDocumentRepositoryContract } from './contracts/stored-document-repository.contract';

const db = moduleTestDatabase({
  moduleName: 'documents',
  migrationsFolder: resolve(__dirname, '../../../infra/db/migrations/documents'),
  isolationKey: 'contract',
});

const describeDb = db.enabled ? describe : describe.skip;

describe('InMemoryStoredDocumentRepository', () => {
  storedDocumentRepositoryContract(
    async (): Promise<StoredDocumentRepository> =>
      new InMemoryStoredDocumentRepository(systemClock),
  );
});

describeDb('DrizzleStoredDocumentRepository', () => {
  beforeAll(async () => {
    await db.setup();
  }, 180_000);

  afterAll(async () => {
    await db.teardown();
  });

  storedDocumentRepositoryContract(async (): Promise<StoredDocumentRepository> => {
    await db.truncate(['documents.stored_documents']);
    return new DrizzleStoredDocumentRepository(createDocumentsDb(db.pool));
  });

  describe('document kinds and subjects', () => {
    const insert = (kind: string, subjectType: string) => {
      const id = newId();
      return db.pool.query(
        `INSERT INTO documents.stored_documents
           (id, kind, subject_type, subject_id, filename, storage_path, content_type,
            byte_size, checksum_sha256, document_at)
         VALUES ($1, $2, $3, $4, 'doc.pdf', $5, 'application/pdf', 2048, $6, now())`,
        [id, kind, subjectType, newId(), `${kind}/${id}-doc.pdf`, 'a'.repeat(64)],
      );
    };

    it('accepts only the kinds and subjects a document can have', async () => {
      await db.truncate(['documents.stored_documents']);

      await insert('quote', 'quote');
      await insert('order_confirmation', 'order');
      await expect(insert('packing_slip', 'order')).rejects.toMatchObject({
        code: '23514',
        constraint: 'stored_documents_kind_check',
      });
      await expect(insert('quote', 'invoice')).rejects.toMatchObject({
        code: '23514',
        constraint: 'stored_documents_subject_type_check',
      });
    });
  });
});
