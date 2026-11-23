// The figures the API priced for one line, shown under its form, with a link to its price build-up.
import {
  freightKnowledge,
  formatMoney,
  formatRatePercent,
  palletsText,
  type QuoteLine,
} from '@erp/types';
import { COLOR, DL, FONT_SIZE, SPACE } from '@erp/ui';

import { formatEstimatedPounds, formatOrderedPounds } from '../../../../../lib/measures';
import { formatPricePerPound } from '../../../../../lib/price-per-pound';
import { SHIPPING_MODE_LABELS, freightCaveat } from '../../../format';
import { typedPriceWords } from '../line-defaults';
import { buildUpHref } from '../steps';

export function LineResults({ line }: { line: QuoteLine }) {
  const knowledge = freightKnowledge(line.freightResult);
  const caveat = freightCaveat(knowledge);

  const perPound = line.pricingBasis === 'per_pound';
  const typed = typedPriceWords(line);
  return (
    <DL style={resultsGrid}>
      {perPound && line.productPricePerLb !== undefined && (
        <>
          <dt style={{ color: COLOR.muted }}>Price per Pound</dt>
          <dd>
            <strong>{formatPricePerPound(line.productPricePerLb)} / lb</strong>
            <span style={{ color: COLOR.muted }}> · product only, before freight</span>

            {typed !== undefined && (
              <span style={{ color: COLOR.muted }}>
                {' '}
                ({typed.inline} — tier price {typed.tierPrice})
              </span>
            )}
          </dd>
        </>
      )}

      <dt style={{ color: COLOR.muted }}>{perPound ? 'Per-roll equivalent' : 'Price / roll'}</dt>
      <dd>
        {formatMoney(line.pricePerRoll)}
        {perPound && <span style={{ color: COLOR.muted }}> (at the estimated roll weight)</span>}
        {typed !== undefined && line.pricingBasis !== 'per_pound' && (
          <span style={{ color: COLOR.muted }}>
            {' '}
            ({typed.inline} — tier price {typed.tierPrice})
          </span>
        )}
        · <a href={buildUpHref(line.quoteId, line.lineNumber)}>Price build-up</a>
      </dd>

      {perPound && line.orderedWeightLb !== undefined && (
        <>
          <dt style={{ color: COLOR.muted }}>Pounds ordered</dt>
          <dd>{formatOrderedPounds(line.orderedWeightLb)} lb</dd>
        </>
      )}

      {perPound && (
        <>
          <dt style={{ color: COLOR.muted }}>Estimated weight</dt>
          <dd>
            {formatEstimatedPounds(line.estimatedWeightLb)} lb
            <span style={{ color: COLOR.muted }}>
              {' '}
              · an estimate; the pallet is weighed at pickup
            </span>
          </dd>
        </>
      )}

      <dt style={{ color: COLOR.muted }}>Freight</dt>
      <dd>
        {SHIPPING_MODE_LABELS[line.freightResult.mode]} —{' '}
        {knowledge === 'unknown' ? (
          <strong>freight TBD</strong>
        ) : (
          <>
            {formatMoney(line.freightResult.invoiceTotal)}
            {knowledge === 'partial' && <strong> + last leg TBD</strong>}
          </>
        )}
      </dd>

      <dt style={{ color: COLOR.muted }}>Delivered / roll</dt>
      <dd>
        {formatMoney(line.deliveredPricePerRoll)}
        {caveat !== undefined && <em style={{ color: COLOR.warning }}>{caveat}</em>}
      </dd>

      {!perPound && (
        <>
          <dt style={{ color: COLOR.muted }}>Estimated weight</dt>
          <dd>{formatEstimatedPounds(line.estimatedWeightLb)} lb</dd>
        </>
      )}

      <dt style={{ color: COLOR.muted }}>Extended</dt>
      <dd>
        {formatMoney(line.extendedPrice)}
        {perPound && <em style={{ color: COLOR.warning }}> — an estimate, priced per pound</em>}
        {caveat !== undefined && <em style={{ color: COLOR.warning }}>{caveat}</em>}
      </dd>

      <dt style={{ color: COLOR.muted }}>Margin</dt>
      <dd>
        {formatRatePercent(line.marginPct)}
        <span style={{ color: COLOR.muted }}>
          {' '}
          {line.marginOverridePct === undefined ? (
            <>
              · tier {line.tier.name}
              {line.tier.source === 'override' && ' (override)'}
            </>
          ) : (
            '· margin entered manually'
          )}{' '}
          · {palletsText(line.pallets)}
        </span>
      </dd>

      <dt style={{ color: COLOR.muted }}>Floor</dt>
      <dd>
        {line.floor.status === 'below_floor' ? (
          <strong style={{ color: COLOR.danger }}>
            BELOW FLOOR — min {formatMoney(line.floor.minimumPricePerRoll)}
          </strong>
        ) : (
          <span style={{ color: COLOR.muted }}>ok</span>
        )}
      </dd>
    </DL>
  );
}

const resultsGrid = {
  rowGap: '0.2rem',
  borderTop: `1px solid ${COLOR.border}`,
  paddingTop: SPACE.md,
  fontSize: FONT_SIZE.md,
} as const;
