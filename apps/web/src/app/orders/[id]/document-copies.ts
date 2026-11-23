// Groups an order's documents. Generated copies of one document fold under the first one listed.
// A received document, such as the customer's PO, always stands alone.
import { type StoredDocumentSummary } from '@erp/types';

export interface DocumentCopies {
  readonly current: StoredDocumentSummary;

  readonly superseded: readonly StoredDocumentSummary[];
}

function groupKey(document: StoredDocumentSummary): string {
  return `${document.subject.type}:${document.subject.id}:${document.kind}`;
}

export function groupDocumentCopies(documents: readonly StoredDocumentSummary[]): DocumentCopies[] {
  const groups: DocumentCopies[] = [];
  const byKey = new Map<string, StoredDocumentSummary[]>();

  for (const document of documents) {
    if (document.source === 'received') {
      groups.push({ current: document, superseded: [] });
      continue;
    }
    const key = groupKey(document);
    const older = byKey.get(key);
    if (older === undefined) {
      const superseded: StoredDocumentSummary[] = [];
      byKey.set(key, superseded);
      groups.push({ current: document, superseded });
      continue;
    }
    older.push(document);
  }

  return groups;
}
