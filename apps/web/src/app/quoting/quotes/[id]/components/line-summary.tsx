// The folded one-row summary of a saved line on the Lines step.
import type { ReactNode } from 'react';

import { formatMoney, freightKnowledge, gradeLabel, type Grade, type QuoteLine } from '@erp/types';
import { COLOR } from '@erp/ui';

import { formatEstimatedPounds, formatFeet, formatWidth } from '../../../../../lib/measures';
import { palletSentence } from '../../../../../lib/pallet-words';
import { formatPricePerPound } from '../../../../../lib/price-per-pound';
import { freightCaveat } from '../../../format';
import { deliveryWords, summaryPricedAt, typedPriceWords } from '../line-defaults';
import { buildUpHref } from '../steps';

export { LineSummary } from '@erp/ui';

export function lineSummaryOf(
  line: QuoteLine,
  grade: Grade | undefined,
  floorOverridden = false,
): { spec: string; delivery: string; price: ReactNode; note: ReactNode } {
  const paper = grade === undefined ? line.gradeId : gradeLabel(grade);
  const rolls = `${line.quantityRolls} roll${line.quantityRolls === 1 ? '' : 's'}`;

  const spec = `Line ${line.lineNumber} · ${paper} · ${formatWidth(line)} × ${formatFeet(
    line.cost.feetPerRoll,
  )} ft · ${rolls}`;
  const caveat = freightCaveat(freightKnowledge(line.freightResult));
  const price =
    line.pricingBasis === 'per_pound' && line.productPricePerLb !== undefined ? (
      <>
        <b>{formatPricePerPound(line.productPricePerLb)}</b> / lb ·{' '}
        {formatMoney(line.extendedPrice)}, an estimate
        {caveat}
      </>
    ) : (
      <>
        <b>{formatMoney(line.deliveredPricePerRoll)}</b> / roll delivered ·{' '}
        {formatMoney(line.extendedPrice)}
        {caveat}
        <span style={{ display: 'block', color: COLOR.muted }}>
          Estimated weight {formatEstimatedPounds(line.estimatedWeightLb)} lb
        </span>
      </>
    );
  const pallets = palletSentence(line.pallets);
  const typed = typedPriceWords(line);
  const note = (
    <>
      {summaryPricedAt(line)},{' '}
      {line.floor.status === 'below_floor' ? (
        floorOverridden ? (
          <strong style={{ color: COLOR.warning }}>
            below the floor (minimum {formatMoney(line.floor.minimumPricePerRoll)} / roll), floor
            overridden
          </strong>
        ) : (
          <strong style={{ color: COLOR.danger }}>
            below the floor (minimum {formatMoney(line.floor.minimumPricePerRoll)} / roll)
          </strong>
        )
      ) : (
        'above the floor'
      )}
      . {pallets}
      {typed !== undefined && (
        <span style={{ color: line.priceSource === 'agreed' ? COLOR.muted : COLOR.warning }}>
          {' '}
          {typed.label} (tier price {typed.tierPrice}).
        </span>
      )}{' '}
      <a href={buildUpHref(line.quoteId, line.lineNumber)}>Price build-up</a>.
    </>
  );

  return { spec, delivery: deliveryWords(line.freight.mode, line.deliveryAddress), price, note };
}
