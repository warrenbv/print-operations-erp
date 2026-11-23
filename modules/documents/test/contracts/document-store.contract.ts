// The contract every `DocumentStore` adapter meets, run by
// modules/documents/test/document-store-contract.test.ts against the in-memory and the local-file store.
// It covers exact byte round-trips, independence from the caller's buffer, write-once refusal, the
// missing-file error, and paths that escape the storage root or name the root itself. A failure in one adapter means the two
// disagree, which callers would see only in one storage mode: docs/process/definition-of-done.md.
import { describe, expect, it } from 'vitest';

import {
  DocumentAlreadyStoredError,
  DocumentStorageError,
  type DocumentStore,
  StoredDocumentMissingError,
} from '../../src/ports';

export function documentStoreContract(name: string, makeStore: () => Promise<DocumentStore>): void {
  describe(`${name} keeps the DocumentStore contract`, () => {
    it('reads back exactly the bytes it was given', async () => {
      const store = await makeStore();
      const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
      await store.put('quote/2026/08/abc-quote.pdf', bytes);

      expect(await store.read('quote/2026/08/abc-quote.pdf')).toEqual(bytes);
      expect(await store.exists('quote/2026/08/abc-quote.pdf')).toBe(true);
    });

    it('is not changed by later edits to the caller buffer', async () => {
      const store = await makeStore();
      const bytes = new Uint8Array([1, 2, 3]);
      await store.put('quote/2026/08/abc-quote.pdf', bytes);
      bytes[0] = 9;

      expect(await store.read('quote/2026/08/abc-quote.pdf')).toEqual(new Uint8Array([1, 2, 3]));
    });

    it('refuses to overwrite a stored document', async () => {
      const store = await makeStore();
      await store.put('quote/2026/08/abc-quote.pdf', new Uint8Array([1]));

      const second = store.put('quote/2026/08/abc-quote.pdf', new Uint8Array([2]));
      await expect(second).rejects.toThrow(DocumentAlreadyStoredError);
      await expect(second).rejects.not.toBeInstanceOf(DocumentStorageError);
      expect(await store.read('quote/2026/08/abc-quote.pdf')).toEqual(new Uint8Array([1]));
    });

    it('reports a missing document as missing', async () => {
      const store = await makeStore();
      const read = store.read('quote/2026/08/nope.pdf');

      await expect(read).rejects.toBeInstanceOf(StoredDocumentMissingError);
      await expect(read).rejects.toMatchObject({ operation: 'read', code: 'missing' });
      expect(await store.exists('quote/2026/08/nope.pdf')).toBe(false);
    });

    it('refuses a path that escapes the storage root', async () => {
      const store = await makeStore();
      await expect(store.put('../outside.pdf', new Uint8Array([1]))).rejects.toThrow(/escapes/);
      await expect(store.put('quote/../../outside.pdf', new Uint8Array([1]))).rejects.toThrow(
        /escapes/,
      );
    });

    it('refuses a path that names the storage root itself', async () => {
      const store = await makeStore();
      for (const path of ['.', '', 'quote/..']) {
        await expect(store.put(path, new Uint8Array([1])), path).rejects.toThrow(/names the/);
        await expect(store.read(path), path).rejects.toThrow(/names the/);
        await expect(store.exists(path), path).rejects.toThrow(/names the/);
      }
    });
  });
}
