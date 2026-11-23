// The documents composition root: where generated and received documents are kept, and the service that renders them.
// Memory mode keeps documents in memory and never reads DOCUMENT_STORAGE_ROOT. PostgreSQL mode keeps the files under that root.
// Storage follows docs/decisions/007-persistence-switch-at-the-composition-root.md. Tests: apps/api/test/documents.factory.test.ts.
import { createPool } from '@erp/db';
import {
  DocumentService,
  DrizzleStoredDocumentRepository,
  InMemoryDocumentStore,
  InMemoryStoredDocumentRepository,
  LocalFileDocumentStore,
  ReactPdfDocumentRenderer,
  createDocumentsDb,
  type DocumentStore,
  type StoredDocumentRepository,
} from '@erp/documents';
import { resolvePersistenceModeFromEnv } from '../config/persistence-guard';
import { apiClock } from '../test-clock';
import { randomUUID } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const DOCUMENTS_STORES = Symbol('DOCUMENTS_STORES');

export interface DocumentsStores {
  store: DocumentStore;
  documents: StoredDocumentRepository;
  close(): Promise<void>;
}

function resolveStorageRoot(env: NodeJS.ProcessEnv): string {
  const root = env.DOCUMENT_STORAGE_ROOT;
  if (root === undefined || root.trim() === '') {
    throw new Error(
      'DOCUMENT_STORAGE_ROOT is not set — generated documents have nowhere to go. ' +
        'Set it to an absolute path.',
    );
  }
  return root;
}

/** Writes and removes a probe file, so an unwritable root stops the boot instead of failing the first document. */
async function proveRootWritable(root: string): Promise<void> {
  const probe = join(root, `.erp-write-probe-${randomUUID()}`);
  try {
    await mkdir(root, { recursive: true });
    await writeFile(probe, 'erp write probe\n', { flag: 'wx' });
    await unlink(probe);
  } catch (err) {
    await unlink(probe).catch(() => undefined);
    const { code, syscall } = err as NodeJS.ErrnoException;

    throw new Error(
      `DOCUMENT_STORAGE_ROOT "${root}" is not writable: ${code ?? 'unknown error'}` +
        `${syscall === undefined ? '' : ` on ${syscall}`}. ` +
        'Generated documents would have nowhere to go, so the api will not start. ' +
        'Check that the directory exists and that the api user can write to it.',
      { cause: err },
    );
  }
}

export async function createDocumentsStores(
  env: NodeJS.ProcessEnv = process.env,
): Promise<DocumentsStores> {
  const persistence = resolvePersistenceModeFromEnv(env);

  if (persistence === 'memory') {
    return {
      store: new InMemoryDocumentStore(),
      documents: new InMemoryStoredDocumentRepository(apiClock),
      close: async () => {},
    };
  }

  const root = resolveStorageRoot(env);

  const store = new LocalFileDocumentStore(root);
  await proveRootWritable(root);
  const pool = createPool({ connectionString: env.DATABASE_URL });
  const db = createDocumentsDb(pool);
  return {
    store,
    documents: new DrizzleStoredDocumentRepository(db),
    close: () => pool.end(),
  };
}

export async function createDocumentService(stores: DocumentsStores): Promise<DocumentService> {
  return new DocumentService({
    renderer: new ReactPdfDocumentRenderer(),
    clock: apiClock,
    store: stores.store,
    documents: stores.documents,
    // The kinds this API renders. A received PO is stored, not rendered.
    supportedKinds: ['quote', 'order_confirmation'],
  });
}
