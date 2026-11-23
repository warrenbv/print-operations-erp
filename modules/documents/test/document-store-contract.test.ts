// Runs the document store contract against `InMemoryDocumentStore` and against `LocalFileDocumentStore`
// on a fresh temporary directory, which is removed afterwards.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll } from 'vitest';

import { InMemoryDocumentStore } from '../src/adapters/in-memory/in-memory-document-store';
import { LocalFileDocumentStore } from '../src/adapters/local-file/local-file-document-store';
import { documentStoreContract } from './contracts/document-store.contract';

const roots: string[] = [];

afterAll(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

documentStoreContract('InMemoryDocumentStore', async () => new InMemoryDocumentStore());

documentStoreContract('LocalFileDocumentStore', async () => {
  const root = await mkdtemp(join(tmpdir(), 'erp-docs-contract-'));
  roots.push(root);
  return new LocalFileDocumentStore(root);
});
