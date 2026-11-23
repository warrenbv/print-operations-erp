// Lists the order's filed documents with their older copies. Each link points at the API's download route,
// so the file comes from the API and not through the web server.
import { type StoredDocumentSummary } from '@erp/types';
import { COLOR } from '@erp/ui';

import { API_BASE_URL } from '../../../../lib/api-fetch';
import { formatTimestamp } from '../../../../lib/dates';
import { DOCUMENT_KIND_LABELS } from '../../format';
import { groupDocumentCopies, type DocumentCopies } from '../document-copies';

export function DocumentsSection({
  orderId,
  documents,
}: {
  orderId: string;
  documents: readonly StoredDocumentSummary[];
}) {
  if (documents.length === 0) {
    return <p style={{ color: COLOR.muted }}>Nothing filed against this order yet.</p>;
  }
  return (
    <ul style={{ listStyle: 'none', padding: 0, display: 'grid', gap: '0.4rem' }}>
      {groupDocumentCopies(documents).map((group) => (
        <li key={group.current.id}>
          <DocumentLine orderId={orderId} document={group.current} />
          <Superseded orderId={orderId} group={group} />
        </li>
      ))}
    </ul>
  );
}

function DocumentLine({ orderId, document }: { orderId: string; document: StoredDocumentSummary }) {
  return (
    <>
      <a
        href={`${API_BASE_URL}/orders/${encodeURIComponent(orderId)}/documents/${encodeURIComponent(document.id)}`}
        style={{ color: COLOR.accent }}
      >
        {document.filename}
      </a>
      <span style={{ color: COLOR.muted }}>
        {' '}
        · {DOCUMENT_KIND_LABELS[document.kind] ?? document.kind} ·{' '}
        {formatTimestamp(document.documentAt)}
        {document.uploadedBy !== null && document.uploadedBy !== undefined && (
          <> · {document.uploadedBy}</>
        )}
      </span>
    </>
  );
}

function Superseded({ orderId, group }: { orderId: string; group: DocumentCopies }) {
  if (group.superseded.length === 0) {
    return null;
  }
  const count = group.superseded.length;
  return (
    <details style={{ marginTop: '0.2rem' }}>
      <summary style={{ color: COLOR.muted, cursor: 'pointer' }}>
        {count} earlier {count === 1 ? 'copy' : 'copies'}: what was printed before this one
      </summary>
      <ul
        style={{
          listStyle: 'none',
          padding: 0,
          margin: '0.3rem 0 0 1rem',
          display: 'grid',
          gap: '0.3rem',
        }}
      >
        {group.superseded.map((document) => (
          <li key={document.id}>
            <DocumentLine orderId={orderId} document={document} />
          </li>
        ))}
      </ul>
    </details>
  );
}
