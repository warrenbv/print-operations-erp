// The local-file store: write-once files, the storage root boundary, path layout, checksums and how
// filesystem failures are classified.
import { execFileSync } from 'node:child_process';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  LocalFileDocumentStore,
  checksumOf,
  classifyStorageFailure,
  documentStoragePath,
} from '../src/adapters/local-file/local-file-document-store';
import {
  DocumentAlreadyStoredError,
  DocumentStorageError,
  StoredDocumentMissingError,
} from '../src/ports';

const RUNS_AS_ROOT = process.platform !== 'win32' && process.getuid?.() === 0;
if (RUNS_AS_ROOT) {
  process.stdout.write(
    '[local-file-document-store] skipping "maps an unwritable directory to not-writable": ' +
      'running as root, which writes through any directory permission\n',
  );
}

async function withUnwritable(dir: string, body: () => Promise<void>): Promise<void> {
  if (process.platform === 'win32') {
    execFileSync('icacls', [dir, '/deny', '*S-1-1-0:(OI)(CI)(WD,AD)'], { stdio: 'ignore' });
    try {
      await body();
    } finally {
      execFileSync('icacls', [dir, '/remove:d', '*S-1-1-0'], { stdio: 'ignore' });
    }
    return;
  }
  await chmod(dir, 0o555);
  try {
    await body();
  } finally {
    await chmod(dir, 0o755);
  }
}

describe('LocalFileDocumentStore', () => {
  let root: string;
  let store: LocalFileDocumentStore;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'erp-docs-'));
    store = new LocalFileDocumentStore(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('writes bytes and reads them back unchanged', async () => {
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
    await store.put('quote/2026/08/abc-quote.pdf', bytes);

    expect(await store.read('quote/2026/08/abc-quote.pdf')).toEqual(bytes);
  });

  it('creates intermediate directories', async () => {
    await store.put('invoice/2027/01/xyz-invoice.pdf', new Uint8Array([1]));

    expect(await readFile(join(root, 'invoice/2027/01/xyz-invoice.pdf'))).toHaveLength(1);
  });

  it('refuses to overwrite an existing document', async () => {
    await store.put('quote/2026/08/abc-quote.pdf', new Uint8Array([1]));

    const second = store.put('quote/2026/08/abc-quote.pdf', new Uint8Array([2]));
    await expect(second).rejects.toThrow(DocumentAlreadyStoredError);

    await expect(second).rejects.not.toBeInstanceOf(DocumentStorageError);

    expect(await store.read('quote/2026/08/abc-quote.pdf')).toEqual(new Uint8Array([1]));
  });

  it('distinguishes a missing file from an unreadable one', async () => {
    await expect(store.read('quote/2026/08/nope.pdf')).rejects.toThrow(StoredDocumentMissingError);
    expect(await store.exists('quote/2026/08/nope.pdf')).toBe(false);
  });

  describe('when the storage itself fails', () => {
    it('maps a root under a plain file to not-a-directory on put', async () => {
      await writeFile(join(root, 'plain'), 'not a directory');
      const broken = new LocalFileDocumentStore(join(root, 'plain', 'documents'));

      await expect(
        broken.put('order_confirmation/2026/10/abc-order-confirmation.pdf', new Uint8Array([1])),
      ).rejects.toMatchObject({
        name: 'DocumentStorageError',
        operation: 'put',
        storagePath: 'order_confirmation/2026/10/abc-order-confirmation.pdf',
        code: 'not-a-directory',
        systemCode: 'ENOTDIR',
      });
    });

    it('maps a read of a path that does not exist to missing', async () => {
      const read = store.read('quote/2026/08/nope.pdf');

      await expect(read).rejects.toBeInstanceOf(DocumentStorageError);
      await expect(read).rejects.toMatchObject({
        operation: 'read',
        storagePath: 'quote/2026/08/nope.pdf',
        code: 'missing',
        systemCode: 'ENOENT',
      });

      await expect(read).rejects.toBeInstanceOf(StoredDocumentMissingError);
    });

    it.skipIf(RUNS_AS_ROOT)(
      'maps an unwritable directory to not-writable (skipped only as root, which writes through any permission)',
      async () => {
        await withUnwritable(root, async () => {
          await expect(
            store.put('quote/2026/10/abc-quote.pdf', new Uint8Array([1])),
          ).rejects.toMatchObject({
            operation: 'put',
            code: 'not-writable',
            systemCode: process.platform === 'win32' ? 'EPERM' : 'EACCES',
          });
        });
      },
    );
  });

  it('refuses a path that escapes the storage root', async () => {
    await expect(store.put('../outside.pdf', new Uint8Array([1]))).rejects.toThrow(/escapes/);
    await expect(store.put('quote/../../outside.pdf', new Uint8Array([1]))).rejects.toThrow(
      /escapes/,
    );
  });

  it('refuses a relative root at construction', async () => {
    expect(() => new LocalFileDocumentStore('relative/docs')).toThrow(/absolute/);
  });
});

describe('classifyStorageFailure', () => {
  it('names each filesystem code the way the 503 names it', () => {
    const cases: [operation: 'put' | 'read', systemCode: string | undefined, expected: string][] = [
      ['put', 'EACCES', 'not-writable'],
      ['put', 'EPERM', 'not-writable'],
      ['put', 'EROFS', 'not-writable'],
      ['read', 'EACCES', 'not-writable'],
      ['put', 'ENOSPC', 'full'],
      ['put', 'ENOTDIR', 'not-a-directory'],
      ['read', 'ENOTDIR', 'not-a-directory'],
      ['read', 'ENOENT', 'missing'],

      ['put', 'ENOENT', 'unknown'],
      ['put', 'EIO', 'unknown'],
      ['read', undefined, 'unknown'],
    ];
    for (const [operation, systemCode, expected] of cases) {
      expect(classifyStorageFailure(operation, systemCode), `${operation} ${systemCode}`).toBe(
        expected,
      );
    }
  });
});

describe('documentStoragePath', () => {
  it('partitions by kind and UTC year/month, prefixed with the id', () => {
    const path = documentStoragePath(
      'quote',
      '0192f1a2-0000-7000-8000-000000000001',
      'quote-Q-0517-20260812.pdf',
      new Date('2026-08-12T10:00:00.000Z'),
    );

    expect(path).toBe(
      'quote/2026/08/0192f1a2-0000-7000-8000-000000000001-quote-Q-0517-20260812.pdf',
    );
  });

  it('pads single-digit months, so directories sort lexically', () => {
    const path = documentStoragePath(
      'order_confirmation',
      'id',
      'f.pdf',
      new Date('2027-01-05T00:00:00.000Z'),
    );
    expect(path).toContain('/2027/01/');
  });

  it('gives two same-day renders of one document different paths', () => {
    const at = new Date('2026-08-12T10:00:00.000Z');
    const first = documentStoragePath('quote', 'id-one', 'quote-Q-0517-20260812.pdf', at);
    const second = documentStoragePath('quote', 'id-two', 'quote-Q-0517-20260812.pdf', at);

    expect(first).not.toBe(second);
  });

  it('uses UTC rather than local time', () => {
    const path = documentStoragePath(
      'purchase_order',
      'id',
      'r.pdf',
      new Date('2026-08-31T23:30:00.000Z'),
    );
    expect(path).toContain('/2026/08/');
  });
});

describe('checksumOf', () => {
  it('is the lowercase hex sha-256 the stored-document contract requires', () => {
    expect(checksumOf(new Uint8Array([]))).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
    expect(checksumOf(new Uint8Array([1, 2, 3]))).toMatch(/^[0-9a-f]{64}$/);
  });
});
