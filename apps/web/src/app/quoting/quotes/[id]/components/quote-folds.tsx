// The folds on a quote's record: cost and margin figures, sends, price approvals and versions.
import type { ReactNode } from 'react';

import {
  formatMoney,
  type Quote,
  type QuoteOverrideDecision,
  type QuoteSendAttempt,
  type QuoteTotals,
  type QuoteWithLines,
} from '@erp/types';
import { COLOR, DL, Fold, ResetList, SPACE } from '@erp/ui';

import { formatTimestamp } from '../../../../../lib/dates';
import { formatEstimatedPounds } from '../../../../../lib/measures';
import { decisionLabel } from '../../../format';
import { pendingFreightCount, perPoundCount } from '../derive';
import { ourFiguresSum, palletWords, tierWords } from '../review/our-figures';
import { buildUpHref } from '../steps';
import { SendsList } from './quote-sends-section';

export function OurFiguresFold({ quote, totals }: { quote: QuoteWithLines; totals: QuoteTotals }) {
  const pendingCount = pendingFreightCount(quote.lines);
  const perPoundLines = perPoundCount(quote.lines);
  const pallets = palletWords(quote.lines);
  return (
    <Fold summary="Our figures" sum={ourFiguresSum(totals)}>
      <DL>
        <dt>Extended price</dt>
        <dd>
          {formatMoney(totals.extendedPrice)}
          {pendingCount > 0 && (
            <em style={{ color: COLOR.warning }}>
              {' '}
              — freight not final on {pendingCount} line{pendingCount === 1 ? '' : 's'}
            </em>
          )}
          {perPoundLines > 0 && (
            <em style={{ color: COLOR.warning }}>
              {' '}
              — includes an estimate on {perPoundLines} line
              {perPoundLines === 1 ? '' : 's'} priced per pound
            </em>
          )}
        </dd>
        <dt>Extended cost</dt>
        <dd>{formatMoney(totals.extendedCost)}</dd>
        <dt>Extended margin</dt>
        <dd>
          {formatMoney(totals.extendedMargin)}
          {quote.lines.length > 0 && (
            <span style={{ color: COLOR.muted }}> · {tierWords(quote.lines)}</span>
          )}
        </dd>

        <dt>Estimated weight</dt>
        <dd>
          {formatEstimatedPounds(totals.estimatedWeightLb)} lb · {pallets}
        </dd>
        {quote.lines.length > 0 && (
          <>
            <dt>Price build-up</dt>
            <dd>
              {quote.lines.map((line, i) => (
                <span key={line.id}>
                  {i > 0 && ' · '}
                  <a href={buildUpHref(quote.id, line.lineNumber)} style={{ color: COLOR.accent }}>
                    Line {line.lineNumber}
                  </a>
                </span>
              ))}
            </dd>
          </>
        )}
      </DL>
    </Fold>
  );
}

export function SendsFold({
  sends,
  open,
  children,
}: {
  sends: readonly QuoteSendAttempt[];
  open?: boolean;
  children?: ReactNode;
}) {
  return (
    <Fold
      summary="Sends"
      sum={sends.length === 0 ? 'not emailed yet' : `${sends.length} sent`}
      open={open}
    >
      <SendsList attempts={sends} />
      {children}
    </Fold>
  );
}

export function PriceApprovalsFold({ decisions }: { decisions: readonly QuoteOverrideDecision[] }) {
  return (
    <Fold
      summary="Price approvals"
      sum={decisions.length === 0 ? 'none on this quote' : `${decisions.length}`}
    >
      {decisions.length === 0 ? (
        <p style={{ margin: 0, color: COLOR.muted }}>
          A hand-set price would be decided here by the Billing Manager, and a line below the floor
          by an Admin.
        </p>
      ) : (
        <ResetList gap={SPACE.sm}>
          {decisions.map((decision) => (
            <li key={decision.id}>
              <strong>{decisionLabel(decision)}</strong>
              <span style={{ color: COLOR.muted }}>
                {' '}
                · {decision.actor} · {formatTimestamp(decision.at)}
              </span>
              {decision.reason !== undefined && <> — &ldquo;{decision.reason}&rdquo;</>}
            </li>
          ))}
        </ResetList>
      )}
    </Fold>
  );
}

export function VersionsFold({
  quote,
  versions,
}: {
  quote: QuoteWithLines;

  versions: readonly Quote[];
}) {
  const latest = versions.at(-1);
  const sum =
    versions.length > 1 ? `v${quote.versionNumber} of ${versions.length}` : 'the only version';
  return (
    <Fold summary="Versions" sum={sum}>
      <p style={{ margin: 0 }}>
        {versions.length === 0 ? (
          <strong>v{quote.versionNumber}</strong>
        ) : (
          versions.map((version, index) => {
            const label = `v${version.versionNumber}${version.id === latest?.id ? ' (current)' : ''}`;
            return (
              <span key={version.id}>
                {index > 0 && ' · '}
                {version.id === quote.id ? (
                  <strong>{label}</strong>
                ) : (
                  <a href={`/quoting/quotes/${version.id}`} style={{ color: COLOR.accent }}>
                    {label}
                  </a>
                )}
              </span>
            );
          })
        )}
      </p>
    </Fold>
  );
}
