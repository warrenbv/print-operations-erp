// Lists the emails about a quote, from apps/web/src/app/quoting/quotes/[id]/send-evidence.ts.
import type { QuoteSendAttempt } from '@erp/types';
import { COLOR, ResetList, SectionNote, SPACE } from '@erp/ui';

import { formatTimestamp } from '../../../../../lib/dates';
import { sendEvidence } from '../send-evidence';

export function SendsList({ attempts }: { attempts: readonly QuoteSendAttempt[] }) {
  const evidence = sendEvidence(attempts);
  return (
    <>
      <SectionNote>
        Times are when the mail relay accepted the message, not when it was delivered.
      </SectionNote>
      {evidence.lines.length === 0 ? (
        <p style={{ margin: 0, color: COLOR.muted }}>This quote has not been emailed yet.</p>
      ) : (
        <ResetList gap={SPACE.sm}>
          {evidence.lines.map((line) => (
            <li key={line.key}>
              <strong style={{ color: line.tone === 'failed' ? COLOR.danger : COLOR.success }}>
                {line.what}
              </strong>{' '}
              <span>{line.to}</span>
              <span style={{ color: COLOR.muted }}>
                {' '}
                · {formatTimestamp(line.submittedAt)} · {line.actor}
              </span>
              {line.why !== undefined && <div style={{ color: COLOR.danger }}>{line.why}</div>}
            </li>
          ))}
        </ResetList>
      )}
      {evidence.retry !== undefined && (
        <p style={{ margin: 0, color: COLOR.muted }}>{evidence.retry}</p>
      )}
    </>
  );
}
