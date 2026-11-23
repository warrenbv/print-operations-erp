// `DocumentService` with storage: what is written, what is recorded, and what happens when a write fails.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { DocumentSubject } from '@erp/types';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { InMemoryStoredDocumentRepository } from '../src/adapters/in-memory/in-memory-stored-document-repository';
import {
  LocalFileDocumentStore,
  checksumOf,
} from '../src/adapters/local-file/local-file-document-store';
import type { DocumentModel } from '../src/document-model';
import { DocumentAlreadyStoredError, type DocumentStore } from '../src/ports';
import { DocumentService } from '../src/services/document-service';

const model: DocumentModel = {
  title: 'Quote Q-0517 v1',
  blocks: [{ type: 'heading', title: 'Quote' }],
};

const fixedClock = { now: () => new Date('2026-08-12T12:00:00.000Z') };
const BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);
const fakeRenderer = { render: async () => BYTES };
const subject: DocumentSubject = { type: 'order', id: '0192f1a2-0000-7000-8000-00000000000a' };

describe('DocumentService storage', () => {
  let root: string;
  let store: LocalFileDocumentStore;
  let documents: InMemoryStoredDocumentRepository;

  const service = () =>
    new DocumentService({ renderer: fakeRenderer, clock: fixedClock, store, documents });

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'erp-docsvc-'));
    store = new LocalFileDocumentStore(root);
    documents = new InMemoryStoredDocumentRepository(fixedClock);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('writes the bytes and records where they went', async () => {
    const stored = await service().renderAndStore('quote', 'Q-0517', subject, model);

    expect(stored).toMatchObject({
      kind: 'quote',
      subject,
      filename: 'quote-Q-0517-20260812.pdf',
      contentType: 'application/pdf',
      byteSize: BYTES.byteLength,
      documentAt: '2026-08-12T12:00:00.000Z',
    });

    expect(await store.read(stored.storagePath)).toEqual(BYTES);
  });

  it('records a digest of the bytes as written', async () => {
    const stored = await service().renderAndStore('quote', 'Q-0517', subject, model);

    expect(stored.checksumSha256).toBe(checksumOf(BYTES));
    expect(stored.checksumSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('re-rendering the same document stores a second one and keeps the first', async () => {
    const svc = service();
    const first = await svc.renderAndStore('quote', 'Q-0517', subject, model);
    const second = await svc.renderAndStore('quote', 'Q-0517', subject, model);

    expect(second.id).not.toBe(first.id);
    expect(second.storagePath).not.toBe(first.storagePath);
    expect(second.filename).toBe(first.filename);
    expect(await store.exists(first.storagePath)).toBe(true);
    expect(await store.exists(second.storagePath)).toBe(true);
  });

  it('lists a subject documents newest first', async () => {
    const svc = service();
    await svc.renderAndStore('quote', 'Q-0517', subject, model);
    await svc.renderAndStore('quote', 'Q-0518', subject, model);

    const listed = await svc.listForSubject(subject);

    expect(listed).toHaveLength(2);
    expect(listed.every((d) => d.subject.id === subject.id)).toBe(true);
  });

  it('refuses a kind with no template before writing anything', async () => {
    await expect(
      service().renderAndStore('order_confirmation', 'ORD-9', subject, model),
    ).rejects.toThrow(/no template/);
    expect(await documents.listForSubject(subject)).toEqual([]);
  });

  it('does not record a row when the file could not be written', async () => {
    const failing: DocumentStore = {
      put: async () => {
        throw new DocumentAlreadyStoredError('quote/2026/08/collision.pdf');
      },
      read: async () => BYTES,
      exists: async () => true,
    };
    const svc = new DocumentService({
      renderer: fakeRenderer,
      clock: fixedClock,
      store: failing,
      documents,
    });

    await expect(svc.renderAndStore('quote', 'Q-0517', subject, model)).rejects.toThrow(
      DocumentAlreadyStoredError,
    );
    expect(await documents.listForSubject(subject)).toEqual([]);
  });

  it('refuses to be constructed with only half of storage', async () => {
    expect(() => new DocumentService({ renderer: fakeRenderer, clock: fixedClock, store })).toThrow(
      /both/,
    );
    expect(
      () => new DocumentService({ renderer: fakeRenderer, clock: fixedClock, documents }),
    ).toThrow(/both/);
  });

  it('a render-only service says so rather than failing obscurely', async () => {
    const renderOnly = new DocumentService({ renderer: fakeRenderer, clock: fixedClock });

    await expect(renderOnly.renderAndStore('quote', 'Q-0517', subject, model)).rejects.toThrow(
      /without storage/,
    );

    await expect(renderOnly.render('quote', 'Q-0517', model)).resolves.toMatchObject({
      kind: 'quote',
    });
  });
});
