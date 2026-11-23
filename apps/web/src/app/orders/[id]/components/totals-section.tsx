// The order's totals in the Totals fold.
import { formatMoney, type OrderLine, type OrderTotals } from '@erp/types';
import { COLOR, KV } from '@erp/ui';

import { perPoundCount } from '../derive';

export function TotalsSection({
  totals,
  lines,
}: {
  totals: OrderTotals;
  lines: readonly OrderLine[];
}) {
  const perPoundLines = perPoundCount(lines);
  return (
    <KV>
      <dt>Extended price</dt>
      <dd>
        {formatMoney(totals.extendedPrice)}

        {totals.freightPending && (
          <em style={{ color: COLOR.warning }}> · freight not final on at least one line</em>
        )}

        {perPoundLines > 0 && (
          <em style={{ color: COLOR.warning }}>
            {' '}
            · includes an estimate on {perPoundLines} line
            {perPoundLines === 1 ? '' : 's'} priced per pound
          </em>
        )}
      </dd>
      <dt>Extended cost</dt>
      <dd>{formatMoney(totals.extendedCost)}</dd>
      <dt>Extended margin</dt>
      <dd>
        {formatMoney(totals.extendedMargin)}

        <span style={{ color: COLOR.muted }}> · includes freight margin</span>
      </dd>
      <dt>Freight</dt>
      <dd>
        {formatMoney(totals.freightInvoiceTotal)}
        <span style={{ color: COLOR.muted }}>
          {' '}
          · cost {formatMoney(totals.freightCost)} + margin {formatMoney(totals.freightMargin)}
        </span>
      </dd>
      <dt>Estimated weight</dt>
      <dd>{`${formatMoney(totals.estimatedWeightLb).replace('$', '')} lb`}</dd>
    </KV>
  );
}
