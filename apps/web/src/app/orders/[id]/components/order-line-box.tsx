// One order line's figures in the Line details fold: paper, size, price, freight and margin.
import { freightKnowledge, formatMoney, palletsText, type Grade, type OrderLine } from '@erp/types';
import { Box, COLOR, DL, FONT_SIZE, SPACE } from '@erp/ui';

import { formatFeet, formatOrderedPounds, formatWidth } from '../../../../lib/measures';

import { formatPricePerPound } from '../../../../lib/price-per-pound';
import { PRODUCT_FAMILY_LABELS, freightCaveat } from '../../../quoting/format';
import { estimatedFreightWords } from '../delivery-words';

export function OrderLineBox({ line, grade }: { line: OrderLine; grade: Grade | undefined }) {
  const knowledge = freightKnowledge(line.freightResult);
  const caveat = freightCaveat(knowledge);
  const estimate = estimatedFreightWords(line.freightResult);

  const perPound = line.pricingBasis === 'per_pound';

  return (
    <Box>
      <div>
        <strong>Line {line.lineNumber}</strong>{' '}
        <span style={{ color: COLOR.muted }}>
          {grade !== undefined
            ? `${PRODUCT_FAMILY_LABELS[grade.productFamily]} — ${grade.code}`
            : line.gradeId}{' '}
          · {line.footageVariant} · {formatWidth(line)}
          {line.feetPerRoll !== undefined && <> · {formatFeet(line.feetPerRoll)} ft</>} ·{' '}
          {line.quantityRolls} roll
          {line.quantityRolls === 1 ? '' : 's'}
          {line.overwrap && ' · overwrap'}
        </span>
      </div>
      <DL style={resultsGrid}>
        {line.customerDescription !== undefined && (
          <>
            <dt style={{ color: COLOR.muted }}>Customer description</dt>
            <dd>{line.customerDescription}</dd>
          </>
        )}
        {line.customerPartNumber !== undefined && (
          <>
            <dt style={{ color: COLOR.muted }}>Customer part number</dt>
            <dd>{line.customerPartNumber}</dd>
          </>
        )}

        {perPound && line.productPricePerLb !== undefined && (
          <>
            <dt style={{ color: COLOR.muted }}>Price per Pound</dt>
            <dd>
              <strong>{formatPricePerPound(line.productPricePerLb)} / lb</strong>
              <span style={{ color: COLOR.muted }}> · product only, before freight</span>
            </dd>
          </>
        )}

        <dt style={{ color: COLOR.muted }}>{perPound ? 'Per-roll equivalent' : 'Price / roll'}</dt>
        <dd>
          {formatMoney(line.pricePerRoll)}
          {perPound && <span style={{ color: COLOR.muted }}> (at the estimated roll weight)</span>}
        </dd>

        {perPound && line.orderedWeightLb !== undefined && (
          <>
            <dt style={{ color: COLOR.muted }}>Pounds ordered</dt>
            <dd>{formatOrderedPounds(line.orderedWeightLb)} lb</dd>
          </>
        )}

        <dt style={{ color: COLOR.muted }}>Freight</dt>
        <dd>
          {estimate.mode}: {estimate.amount}
          {estimate.tbd !== undefined && (
            <strong>
              {estimate.amount === undefined ? '' : ' '}
              {estimate.tbd}
            </strong>
          )}
        </dd>

        <dt style={{ color: COLOR.muted }}>Extended</dt>
        <dd>
          {formatMoney(line.extendedPrice)}
          {perPound && <em style={{ color: COLOR.warning }}> · an estimate, priced per pound</em>}
          {caveat !== undefined && <em style={{ color: COLOR.warning }}>{caveat}</em>}
        </dd>

        <dt style={{ color: COLOR.muted }}>Margin</dt>
        <dd>
          {formatMoney(line.extendedMargin)}
          <span style={{ color: COLOR.muted }}> · {palletsText(line.pallets)}</span>
        </dd>

        <dt style={{ color: COLOR.muted }}>Estimated weight</dt>
        <dd>{`${formatMoney(line.estimatedWeightLb).replace('$', '')} lb`}</dd>
      </DL>
    </Box>
  );
}

const resultsGrid = {
  rowGap: '0.2rem',
  borderTop: `1px solid ${COLOR.border}`,
  paddingTop: SPACE.md,
  fontSize: FONT_SIZE.md,
} as const;
