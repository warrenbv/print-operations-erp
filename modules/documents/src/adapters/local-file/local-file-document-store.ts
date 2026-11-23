// The `DocumentStore` on a local directory. Paths are partitioned by kind, then UTC year and month,
// and a file is written once. The API chooses the root in apps/api/src/documents/documents.factory.ts.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, normalize, resolve, sep } from 'node:path';

import type { DocumentKind, DocumentStorageFailure } from '@erp/types';

import {
  DocumentAlreadyStoredError,
  DocumentStorageError,
  type DocumentStore,
  StoredDocumentMissingError,
} from '../../ports';

export class LocalFileDocumentStore implements DocumentStore {
  readonly #root: string;

  constructor(root: string) {
    if (!isAbsolute(root)) {
      throw new Error(`document storage root must be an absolute path, got "${root}"`);
    }
    this.#root = resolve(root);
  }

  async put(storagePath: string, bytes: Uint8Array): Promise<void> {
    const full = this.#resolveWithin(storagePath);
    try {
      await mkdir(dirname(full), { recursive: true });
    } catch (err) {
      throw storageFailure('put', storagePath, err);
    }
    try {
      // `wx` fails when the file exists, so a stored document is never overwritten.
      await writeFile(full, bytes, { flag: 'wx' });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
        throw new DocumentAlreadyStoredError(storagePath);
      }
      throw storageFailure('put', storagePath, err);
    }
  }

  async read(storagePath: string): Promise<Uint8Array> {
    const full = this.#resolveWithin(storagePath);
    try {
      const buffer = await readFile(full);

      // A Buffer can be a slice of a larger shared pool, so the view keeps its offset and length.
      return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    } catch (err) {
      throw storageFailure('read', storagePath, err);
    }
  }

  async exists(storagePath: string): Promise<boolean> {
    try {
      await readFile(this.#resolveWithin(storagePath));
      return true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw err;
    }
  }

  get root(): string {
    return this.#root;
  }

  #resolveWithin(storagePath: string): string {
    const full = resolve(join(this.#root, normalize(storagePath)));
    // A path that normalises to the root itself names no file, and is refused the same way in memory.
    if (full === this.#root) {
      throw new Error(
        `storage path "${storagePath}" names the document storage root, not a file in it`,
      );
    }
    // A path that normalises to somewhere outside the root is refused, so a crafted path cannot
    // reach other files.
    if (!full.startsWith(this.#root + sep)) {
      throw new Error(`storage path "${storagePath}" escapes the document storage root`);
    }
    return full;
  }
}

/**
 * Maps a filesystem error code to the failure the API reports. ENOENT on a read means the record and
 * the store disagree. On a write it is unexpected and counts as unknown.
 */
export function classifyStorageFailure(
  operation: 'put' | 'read',
  systemCode: string | undefined,
): DocumentStorageFailure {
  switch (systemCode) {
    case 'EACCES':
    case 'EPERM':
    case 'EROFS':
      return 'not-writable';
    case 'ENOSPC':
      return 'full';
    case 'ENOTDIR':
      return 'not-a-directory';
    case 'ENOENT':
      return operation === 'read' ? 'missing' : 'unknown';
    default:
      return 'unknown';
  }
}

function storageFailure(
  operation: 'put' | 'read',
  storagePath: string,
  err: unknown,
): DocumentStorageError {
  const systemCode = (err as NodeJS.ErrnoException | undefined)?.code;
  const code = classifyStorageFailure(operation, systemCode);

  return code === 'missing'
    ? new StoredDocumentMissingError(storagePath, err)
    : new DocumentStorageError(operation, storagePath, code, systemCode, err);
}

/** Lowercase hex SHA-256, the form `storedDocumentSchema` and the baseline's checksum CHECK require. */
export function checksumOf(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * The id prefix keeps two renders of one document on one day at different paths. The month is
 * zero-padded so directories sort.
 */
export function documentStoragePath(
  kind: DocumentKind,
  id: string,
  filename: string,
  documentAt: Date,
): string {
  const year = String(documentAt.getUTCFullYear());
  const month = String(documentAt.getUTCMonth() + 1).padStart(2, '0');
  return `${kind}/${year}/${month}/${id}-${filename}`;
}
