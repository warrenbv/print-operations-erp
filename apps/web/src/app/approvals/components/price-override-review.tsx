// One quote awaiting a price decision: each hand-set line's figures and the forms to decide it.
// The hand-set price and the floor have separate forms because they have separate owners:
// docs/product/requirements.md (R6, R7) and docs/product/decisions.md.
// Each form carries the quote's `lockVersion`, tying the decision to the figures on screen:
// docs/decisions/006-optimistic-concurrency.md.
import type { ReactNode } from 'react';

import type { PendingPriceOverride, QuoteLine, QuoteWithLines, ResolvedSalesRep } from '@erp/types';
import { Box, Button, COLOR, Field, FieldLabel, FONT_SIZE, RADIUS, SPACE } from '@erp/ui';
import {
  formatMeasure,
  formatMoney,
  formatRatePercent,
  formatWidthIn,
  palletsText,
  quoteReference,
} from '@erp/types';

import { footageUsed } from '../../../lib/pallet-words';
import { formatPricePerPound } from '../../../lib/price-per-pound';
import { SalesRepName } from '../../../lib/sales-rep-name';
import {
  approveFloorOverrideAction,
  approveOverrideAction,
  rejectFloorOverrideAction,
  rejectOverrideAction,
} from '../actions';
import {
  agreedPriceSentence,
  belowFloorLines,
  belowFloorSentence,
  enteredMarginSentence,
  handSetLines,
  handSetReason,
  needsWords,
  tierLineCount,
} from '../derive';

export function PriceOverrideReview({
  pending,
  full,
  customerName,
  salesRep,
  canDecide,
  canDecideFloor,
  waiting,
}: {
  pending: PendingPriceOverride;
  full: QuoteWithLines | undefined;
  customerName: string;

  salesRep: ResolvedSalesRep | undefined;

  canDecide: boolean;

  canDecideFloor: boolean;

  waiting: ReactNode;
}) {
  if (full === undefined) {
    return (
      <section style={card}>
        <h2 style={cardTitle}>{quoteReference(pending)}</h2>
        <p style={{ color: COLOR.warning }}>
          This quote changed while the page was loading and is no longer awaiting approval. Reload
          to see the queue as it stands.
        </p>
      </section>
    );
  }

  const handSet = handSetLines(full.lines);
  const belowFloor = belowFloorLines(full.lines);
  const needsPrice = pending.needs.includes('price');
  const needsFloor = pending.needs.includes('floor');

  const entered = full.lines.filter((l) => l.marginOverridePct !== undefined);
  const agreed = full.lines.filter((l) => l.priceSource === 'agreed');
  const others = tierLineCount(full.lines);

  return (
    <section style={card}>
      <h2 style={cardTitle}>
        <a href={`/quoting/quotes/${pending.quoteId}`} style={{ color: COLOR.accent }}>
          {quoteReference(pending)}
        </a>{' '}
        <span style={{ fontWeight: 400 }}>{customerName}</span>
      </h2>
      <p style={{ color: COLOR.muted }}>
        v{pending.versionNumber} ·{' '}
        {salesRep === undefined ? (
          'Asked by: not recorded'
        ) : (
          <>
            Asked by <SalesRepName rep={salesRep} />
          </>
        )}{' '}
        · {waiting}
      </p>

      <p style={{ margin: `0 0 ${SPACE.sm}` }}>{needsWords(pending.needs)}</p>

      {needsPrice && handSet.length === 0 ? (
        <p style={{ color: COLOR.warning }}>
          No line carries a hand-set price any more, so there is nothing to approve.
        </p>
      ) : (
        handSet.map((line) => <LineReview key={line.id} line={line} />)
      )}

      {needsPrice && others > 0 && (
        <p style={{ color: COLOR.muted }}>
          {others} further line{others === 1 ? '' : 's'} on this quote {others === 1 ? 'is' : 'are'}{' '}
          priced at tier and {others === 1 ? 'is' : 'are'} not part of this decision.
        </p>
      )}
      {entered.map((line) => (
        <p key={line.id} style={{ color: COLOR.muted }}>
          {enteredMarginSentence(line)}
        </p>
      ))}
      {agreed.map((line) => (
        <p key={line.id} style={{ color: COLOR.muted }}>
          {agreedPriceSentence(line)}
        </p>
      ))}

      {canDecide && needsPrice && handSet.length > 0 && (
        <DecisionForms quoteId={pending.quoteId} lockVersion={full.lockVersion} />
      )}

      {needsFloor && (
        <div style={floorBlock}>
          {belowFloor.map((line) => (
            <p key={line.lineNumber} style={{ margin: 0, color: COLOR.warning }}>
              {belowFloorSentence(line)}
            </p>
          ))}
          {canDecideFloor ? (
            <FloorDecisionForms quoteId={pending.quoteId} lockVersion={full.lockVersion} />
          ) : (
            <p style={{ margin: `${SPACE.xs} 0 0`, color: COLOR.muted }}>An Admin decides this.</p>
          )}
        </div>
      )}
    </section>
  );
}

function LineReview({ line }: { line: QuoteLine }) {
  const handSet = line.overridePricePerRoll;
  const handSetPerLb = line.overridePricePerLb;
  const perPound = line.pricingBasis === 'per_pound';
  return (
    <Box style={{ padding: '0.6rem 0.8rem', margin: '0.6rem 0', display: 'block' }}>
      <p style={{ margin: '0 0 0.4rem' }}>{handSetReason(line)}</p>
      <p style={{ margin: '0 0 0.4rem' }}>
        <strong>Line {line.lineNumber}</strong>{' '}
        <span style={{ color: COLOR.muted }}>
          {line.footageVariant} · {formatWidthIn(line.rollWidthIn)} · {line.quantityRolls} roll
          {line.quantityRolls === 1 ? '' : 's'} · {palletsText(line.pallets)}
          {line.overwrap && ' · overwrap'}
        </span>
      </p>

      <dl style={grid}>
        {perPound && line.basePricePerLb !== undefined && (
          <>
            <dt style={{ color: COLOR.muted }}>Engine price / lb</dt>
            <dd>
              {formatPricePerPound(line.basePricePerLb)}
              <span style={{ color: COLOR.muted }}>
                {' '}
                · tier {line.tier.name} at {formatRatePercent(line.tier.marginPct)}
                {line.tier.source === 'override' && ' (tier hand-picked)'}
              </span>
            </dd>

            <dt style={{ color: COLOR.muted }}>Hand-set price / lb</dt>
            <dd>
              <strong>
                {handSetPerLb === undefined ? '—' : formatPricePerPound(handSetPerLb)}
              </strong>
              <span style={{ color: COLOR.muted }}> · what the customer is billed per pound</span>
            </dd>

            <dt style={{ color: COLOR.muted }}>Per-roll equivalent</dt>
            <dd>
              {formatMoney(line.pricePerRoll)}
              <span style={{ color: COLOR.muted }}>
                {' '}
                · the price per pound times {formatMeasure(line.cost.rollWeightLb)} lb, and what the
                floor is judged on
              </span>
            </dd>
          </>
        )}

        {!perPound && (
          <>
            <dt style={{ color: COLOR.muted }}>Engine price / roll</dt>
            <dd>
              {formatMoney(line.basePricePerRoll)}
              <span style={{ color: COLOR.muted }}>
                {' '}
                · tier {line.tier.name} at {formatRatePercent(line.tier.marginPct)}
                {line.tier.source === 'override' && ' (tier hand-picked)'}
              </span>
            </dd>

            <dt style={{ color: COLOR.muted }}>Hand-set price / roll</dt>
            <dd>
              <strong>{handSet === undefined ? '—' : formatMoney(handSet)}</strong>
            </dd>
          </>
        )}

        <dt style={{ color: COLOR.muted }}>Margin as priced</dt>
        <dd>
          {formatRatePercent(line.marginPct)}
          <span style={{ color: COLOR.muted }}>
            {' '}
            · floor {line.floor.status === 'ok' ? 'met' : 'BREACHED'}
          </span>
        </dd>

        <dt style={{ color: COLOR.muted }}>Extended</dt>
        <dd>
          {formatMoney(line.extendedPrice)}
          <span style={{ color: COLOR.muted }}>
            {' '}
            · cost {formatMoney(line.extendedCost)} · margin {formatMoney(line.extendedMargin)}
          </span>
        </dd>
      </dl>

      <details>
        <summary style={{ cursor: 'pointer', color: COLOR.muted }}>Cost build-up</summary>
        <dl style={grid}>
          <dt style={{ color: COLOR.muted }}>Est. roll weight</dt>

          <dd>{formatMeasure(line.cost.rollWeightLb)} lb</dd>

          <dt style={{ color: COLOR.muted }}>Paper cost / lb</dt>
          <dd>{formatMoney(line.cost.paperCostPerLb)}</dd>
          <dt style={{ color: COLOR.muted }}>Paper / roll</dt>
          <dd>{formatMoney(line.cost.paperCostPerRoll)}</dd>
          <dt style={{ color: COLOR.muted }}>Hardware / roll</dt>
          <dd>{formatMoney(line.cost.hardwareCostPerRoll)}</dd>
          <dt style={{ color: COLOR.muted }}>Add-ons / roll</dt>
          <dd>{formatMoney(line.cost.addOnCostPerRoll)}</dd>
          <dt style={{ color: COLOR.muted }}>Total cost / roll</dt>
          <dd>
            <strong>{formatMoney(line.cost.totalCostPerRoll)}</strong>
          </dd>
          <dt style={{ color: COLOR.muted }}>Footage used</dt>
          <dd>{footageUsed(line.cost.feetPerRoll, line.cost.rollsPerPallet)}</dd>
        </dl>

        <p style={{ color: COLOR.muted }}>
          The total is rounded once, so the figures above can differ from it by half a cent.
        </p>
      </details>
    </Box>
  );
}

function DecisionForms({
  quoteId,
  lockVersion,
}: {
  quoteId: string;
  lockVersion: number;
}): ReactNode {
  return (
    <div style={{ display: 'grid', gap: '0.75rem', marginTop: '0.75rem' }}>
      <form action={approveOverrideAction} style={labelledRow}>
        <input type="hidden" name="quoteId" value={quoteId} />

        <input type="hidden" name="lockVersion" value={lockVersion} />
        <div style={{ flex: 1 }}>
          <Field>
            <FieldLabel>Note (optional)</FieldLabel>
            <input type="text" name="reason" maxLength={500} style={inputStyle} />
          </Field>
        </div>
        <Button variant="primary">Approve price</Button>
      </form>

      <form action={rejectOverrideAction} style={labelledRow}>
        <input type="hidden" name="quoteId" value={quoteId} />
        <input type="hidden" name="lockVersion" value={lockVersion} />
        <div style={{ flex: 1 }}>
          <Field>
            <FieldLabel>Reason for Sales (required)</FieldLabel>
            <input type="text" name="reason" required maxLength={500} style={inputStyle} />
          </Field>
        </div>
        <Button>Reject</Button>
      </form>
    </div>
  );
}

function FloorDecisionForms({
  quoteId,
  lockVersion,
}: {
  quoteId: string;
  lockVersion: number;
}): ReactNode {
  return (
    <div style={{ display: 'grid', gap: '0.75rem', marginTop: '0.75rem' }}>
      <form action={approveFloorOverrideAction} style={labelledRow}>
        <input type="hidden" name="quoteId" value={quoteId} />
        <input type="hidden" name="lockVersion" value={lockVersion} />
        <div style={{ flex: 1 }}>
          <Field>
            <FieldLabel>Why it may go out below the floor (required)</FieldLabel>
            <input type="text" name="reason" required maxLength={500} style={inputStyle} />
          </Field>
        </div>
        <Button variant="primary">Approve below the floor</Button>
      </form>

      <form action={rejectFloorOverrideAction} style={labelledRow}>
        <input type="hidden" name="quoteId" value={quoteId} />
        <input type="hidden" name="lockVersion" value={lockVersion} />
        <div style={{ flex: 1 }}>
          <Field>
            <FieldLabel>Why it may not (required)</FieldLabel>
            <input type="text" name="reason" required maxLength={500} style={inputStyle} />
          </Field>
        </div>
        <Button>Reject below the floor</Button>
      </form>
    </div>
  );
}

const card = {
  border: `1px solid ${COLOR.border}`,
  borderRadius: RADIUS,
  padding: '0.9rem 1.1rem',
  margin: `${SPACE.xl} 0`,
} as const;

const cardTitle = { margin: '0 0 0.2rem', fontSize: FONT_SIZE.lg } as const;

const grid = {
  display: 'grid',
  gridTemplateColumns: 'auto 1fr',
  columnGap: '0.75rem',
  rowGap: '0.2rem',
  margin: '0.4rem 0',
} as const;

const floorBlock = {
  border: `1px solid ${COLOR.warning}`,
  borderRadius: RADIUS,
  padding: '0.6rem 0.9rem',
  marginTop: SPACE.lg,
} as const;

const labelledRow = { display: 'flex', gap: SPACE.md, alignItems: 'flex-end' } as const;

const inputStyle = {
  padding: '0.4rem 0.5rem',
  fontFamily: 'inherit',
  fontSize: '0.95rem',
} as const;
