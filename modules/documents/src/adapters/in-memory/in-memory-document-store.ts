// The `DocumentStore` the API uses in memory mode. Generated and uploaded documents live in this
// process and are gone on restart. Postgres mode uses
// modules/documents/src/adapters/local-file/local-file-document-store.ts instead, and both must pass
// modules/documents/test/contracts/document-store.contract.ts.
import { posix } from 'node:path';

import {
  DocumentAlreadyStoredError,
  type DocumentStore,
  StoredDocumentMissingError,
} from '../../ports';

export class InMemoryDocumentStore implements DocumentStore {
  readonly #files = new Map<string, Uint8Array>();

  async put(storagePath: string, bytes: Uint8Array): Promise<void> {
    const key = keyFor(storagePath);
    if (this.#files.has(key)) {
      throw new DocumentAlreadyStoredError(storagePath);
    }
    // Stored and returned as copies, so a caller editing its buffer cannot change a stored document.
    this.#files.set(key, new Uint8Array(bytes));
  }

  async read(storagePath: string): Promise<Uint8Array> {
    const bytes = this.#files.get(keyFor(storagePath));
    if (bytes === undefined) {
      throw new StoredDocumentMissingError(storagePath);
    }
    return new Uint8Array(bytes);
  }

  async exists(storagePath: string): Promise<boolean> {
    return this.#files.has(keyFor(storagePath));
  }
}

// Refuses a path that names the storage root or would escape it, as the file store does, so the two
// adapters fail alike on a crafted path.
function keyFor(storagePath: string): string {
  const key = posix.normalize(storagePath.replaceAll('\\', '/'));
  if (key === '.') {
    throw new Error(
      `storage path "${storagePath}" names the document storage root, not a file in it`,
    );
  }
  if (key.startsWith('/') || key === '..' || key.startsWith('../')) {
    throw new Error(`storage path "${storagePath}" escapes the document storage root`);
  }
  return key;
}
