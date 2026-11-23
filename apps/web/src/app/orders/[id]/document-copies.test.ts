// Tests grouping an order's documents into copies.
import { type DocumentKind, type StoredDocumentSummary } from '@erp/types';
import { describe, expect, it } from 'vitest';

import { groupDocumentCopies } from './document-copies';

const ORDER = '01a05e61-0000-7000-8000-000000000001';

let seq = 0;

function doc(
  overrides: {
    kind?: DocumentKind;
    source?: 'generated' | 'received';
    filename?: string;
  } = {},
): StoredDocumentSummary {
  seq += 1;
  return {
    id: `01a05e61-0000-7000-9000-${String(seq).padStart(12, '0')}`,
    kind: overrides.kind ?? 'order_confirmation',
    subject: { type: 'order', id: ORDER },
    filename: overrides.filename ?? `file-${String(seq)}.pdf`,
    contentType: 'application/pdf',
    byteSize: 1024,
    checksumSha256: 'a'.repeat(64),
    documentAt: '2026-09-01T10:00:00.000Z',
    storedAt: '2026-09-01T10:00:00.000Z',
    source: overrides.source ?? 'generated',
    uploadedBy: null,
    originalFilename: null,
  };
}

describe('groupDocumentCopies', () => {
  it('keeps a single document as its own group with nothing superseded', () => {
    const only = doc();
    expect(groupDocumentCopies([only])).toEqual([{ current: only, superseded: [] }]);
  });

  it('treats the first copy as current and the rest as superseded', () => {
    const newest = doc();
    const older = doc();
    const oldest = doc();

    expect(groupDocumentCopies([newest, older, oldest])).toEqual([
      { current: newest, superseded: [older, oldest] },
    ]);
  });

  it('never groups received documents, however many there are', () => {
    const first = doc({ kind: 'purchase_order', source: 'received', filename: 'po.pdf' });
    const second = doc({ kind: 'purchase_order', source: 'received', filename: 'po-revised.pdf' });

    expect(groupDocumentCopies([first, second])).toEqual([
      { current: first, superseded: [] },
      { current: second, superseded: [] },
    ]);
  });

  it('emits each group where its first copy sat, keeping the caller order', () => {
    const confirmationNew = doc();
    const po = doc({ kind: 'purchase_order', source: 'received', filename: 'po.pdf' });
    const confirmationOld = doc();

    const groups = groupDocumentCopies([confirmationNew, po, confirmationOld]);
    expect(groups).toEqual([
      { current: confirmationNew, superseded: [confirmationOld] },
      { current: po, superseded: [] },
    ]);
  });

  it('accounts for every document exactly once', () => {
    const documents = [
      doc(),
      doc(),
      doc({ kind: 'purchase_order', source: 'received' }),
      doc({ kind: 'purchase_order', source: 'received' }),
    ];

    const seen = groupDocumentCopies(documents).flatMap((group) => [
      group.current,
      ...group.superseded,
    ]);
    expect(seen).toHaveLength(documents.length);
    expect(new Set(seen.map((d) => d.id)).size).toBe(documents.length);
  });

  it('has nothing to say about an empty list', () => {
    expect(groupDocumentCopies([])).toEqual([]);
  });
});
