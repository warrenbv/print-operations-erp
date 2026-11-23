// The contract every `StoredDocumentRepository` adapter meets, run by
// modules/documents/test/repository-contracts.test.ts against the in-memory and the PostgreSQL adapter.
// It covers duplicate refusal, lookup by subject across subject types, and newest-first ordering with
// an id tiebreak. A failure in one adapter only means the two disagree, which callers would see only
// in one storage mode: docs/process/definition-of-done.md.
import { newId } from '@erp/db';
import type { DocumentSubject } from '@erp/types';
import { describe, expect, it } from 'vitest';

import type { NewStoredDocument, StoredDocumentRepository } from '../../src/ports';

export function storedDocumentRepositoryContract(
  makeRepo: () => Promise<StoredDocumentRepository>,
): void {
  const GENERATED = new Date('2026-08-12T10:00:00.000Z');

  const newDoc = (over: Partial<NewStoredDocument> = {}): NewStoredDocument => {
    const id = over.id ?? newId();
    return {
      id,
      kind: 'quote',
      subject: { type: 'order', id: newId() },
      filename: 'quote-Q-0517-20260812.pdf',
      storagePath: `quote/2026/08/${id}-quote-Q-0517-20260812.pdf`,
      contentType: 'application/pdf',
      byteSize: 3187,
      checksumSha256: 'a'.repeat(64),
      documentAt: GENERATED,

      source: 'generated',
      uploadedBy: null,
      originalFilename: null,
      ...over,
    };
  };

  describe('record', () => {
    it('returns the stored document with its subject and digest intact', async () => {
      const repo = await makeRepo();
      const input = newDoc();

      const stored = await repo.record(input);

      expect(stored).toMatchObject({
        id: input.id,
        kind: 'quote',
        subject: input.subject,
        filename: input.filename,
        storagePath: input.storagePath,
        contentType: 'application/pdf',
        byteSize: 3187,
        checksumSha256: input.checksumSha256,
        documentAt: GENERATED.toISOString(),
        source: 'generated',
        uploadedBy: null,

        originalFilename: null,
      });
    });

    it('records a received document with its own type and its uploader', async () => {
      const repo = await makeRepo();
      const id = newId();
      const stored = await repo.record(
        newDoc({
          id,
          kind: 'purchase_order',
          filename: 'their-po.jpg',
          storagePath: `purchase_order/2026/08/${id}-their-po.jpg`,
          contentType: 'image/jpeg',
          source: 'received',
          uploadedBy: 'dev-sales',
          originalFilename: 'their PO (scan).jpg',
        }),
      );

      expect(stored).toMatchObject({
        kind: 'purchase_order',
        contentType: 'image/jpeg',
        source: 'received',
        uploadedBy: 'dev-sales',

        originalFilename: 'their PO (scan).jpg',
      });
    });

    it('carries documentAt through rather than re-stamping it', async () => {
      const repo = await makeRepo();
      const stored = await repo.record(newDoc());

      expect(stored.documentAt).toBe(GENERATED.toISOString());
      expect(Date.parse(stored.storedAt)).toBeGreaterThanOrEqual(Date.parse(stored.documentAt));
    });

    it('refuses a storage path another document already claims', async () => {
      const repo = await makeRepo();
      const first = newDoc();
      await repo.record(first);

      await expect(repo.record(newDoc({ storagePath: first.storagePath }))).rejects.toThrow();
    });

    it('refuses a repeated id', async () => {
      const repo = await makeRepo();
      const first = newDoc();
      await repo.record(first);

      await expect(repo.record(newDoc({ id: first.id }))).rejects.toThrow();
    });

    it('stores a second document for the same subject and kind', async () => {
      const repo = await makeRepo();
      const subject: DocumentSubject = { type: 'order', id: newId() };
      const first = await repo.record(newDoc({ subject }));
      const second = await repo.record(newDoc({ subject }));

      expect(second.id).not.toBe(first.id);
      expect(await repo.findById(first.id)).not.toBeNull();
      expect(await repo.listForSubject(subject)).toHaveLength(2);
    });
  });

  describe('findById', () => {
    it('returns null for an id nothing was stored under', async () => {
      const repo = await makeRepo();
      expect(await repo.findById(newId())).toBeNull();
    });
  });

  describe('listForSubject', () => {
    it('returns only that subject, and not a different record with the same id', async () => {
      const repo = await makeRepo();
      const sharedId = newId();
      await repo.record(newDoc({ subject: { type: 'order', id: sharedId } }));
      await repo.record(newDoc({ subject: { type: 'quote', id: sharedId } }));

      const forOrder = await repo.listForSubject({ type: 'order', id: sharedId });

      expect(forOrder).toHaveLength(1);
      expect(forOrder[0]?.subject.type).toBe('order');
    });

    it('returns empty for a subject with no documents', async () => {
      const repo = await makeRepo();
      expect(await repo.listForSubject({ type: 'order', id: newId() })).toEqual([]);
    });

    it('orders newest first, with a total order when timestamps tie', async () => {
      const repo = await makeRepo();
      const subject: DocumentSubject = { type: 'order', id: newId() };
      const stored = [
        await repo.record(newDoc({ subject })),
        await repo.record(newDoc({ subject })),
        await repo.record(newDoc({ subject })),
      ];

      const listed = await repo.listForSubject(subject);

      expect(listed).toHaveLength(3);
      const expected = [...stored].sort((a, b) => {
        const byTime = b.storedAt.localeCompare(a.storedAt);
        return byTime !== 0 ? byTime : b.id.localeCompare(a.id);
      });
      expect(listed.map((d) => d.id)).toEqual(expected.map((d) => d.id));
    });
  });

  describe('listForSubject across subject types', () => {
    it('does not match a different record that shares an id', async () => {
      const repo = await makeRepo();
      const sharedId = newId();
      await repo.record(newDoc({ subject: { type: 'order', id: sharedId } }));
      await repo.record(newDoc({ subject: { type: 'quote', id: sharedId } }));

      const listed = await repo.listForSubject({ type: 'quote', id: sharedId });

      expect(listed).toHaveLength(1);
      expect(listed[0]?.subject.type).toBe('quote');
    });
  });
}
