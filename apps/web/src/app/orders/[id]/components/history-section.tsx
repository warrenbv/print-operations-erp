// The order's recorded status moves, with who made each one and when.
import { type OrderTransition } from '@erp/types';
import { COLOR } from '@erp/ui';

import { formatTimestamp } from '../../../../lib/dates';
import { ORDER_STATUS_LABELS } from '../../format';

export function HistorySection({ transitions }: { transitions: readonly OrderTransition[] }) {
  if (transitions.length === 0) {
    return <p style={{ color: COLOR.muted }}>No recorded moves.</p>;
  }
  return (
    <ul style={{ listStyle: 'none', padding: 0, display: 'grid', gap: '0.4rem' }}>
      {transitions.map((t) => (
        <li key={t.id}>
          <strong>{ORDER_STATUS_LABELS[t.to]}</strong>
          <span style={{ color: COLOR.muted }}>
            {' '}
            · {t.actor} · {formatTimestamp(t.at)}
          </span>
          {t.reason !== undefined && <>: &quot;{t.reason}&quot;</>}
        </li>
      ))}
    </ul>
  );
}
