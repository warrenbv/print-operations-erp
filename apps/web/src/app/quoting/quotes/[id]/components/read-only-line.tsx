// One quote line, read only, for a reader who may not edit it.
import { formatMoney, formatRatePercent, type Grade, type QuoteLine } from '@erp/types';
import { LineResults } from './line-results';
import { Box, COLOR } from '@erp/ui';

import { NO_DELIVERY_DESTINATION, addressText } from '../../../../../lib/address';
import { formatFeet, formatWidth } from '../../../../../lib/measures';
import {
  PRODUCT_FAMILY_LABELS,
  REVENUE_CATEGORY_LABELS,
  SHIPPING_MODE_LABELS,
  TAX_STATUS_LABELS,
} from '../../../format';

export function ReadOnlyLine({ line, grade }: { line: QuoteLine; grade: Grade | undefined }) {
  return (
    <Box>
      <div>
        <strong>Line {line.lineNumber}</strong>{' '}
        <span style={{ color: COLOR.muted }}>
          {grade !== undefined
            ? `${PRODUCT_FAMILY_LABELS[grade.productFamily]} — ${grade.code}`
            : line.gradeId}{' '}
          · {line.footageVariant} · {formatWidth(line)} · {formatFeet(line.cost.feetPerRoll)} ft
          {line.feetPerRollOverride !== undefined && ' (custom)'} · {line.quantityRolls} roll
          {line.quantityRolls === 1 ? '' : 's'}
          {line.overwrap && ' · overwrap'}
          {line.printed && ' · printed'}
        </span>
      </div>

      {(line.customerDescription !== undefined || line.customerPartNumber !== undefined) && (
        <div>
          Customer:{' '}
          {[
            line.customerDescription,
            line.customerPartNumber === undefined ? undefined : `Part ${line.customerPartNumber}`,
          ]
            .filter((part) => part !== undefined)
            .join(' · ')}
        </div>
      )}
      <div style={{ color: COLOR.muted }}>
        Shipping: {SHIPPING_MODE_LABELS[line.freight.mode]}
        {(line.freight.mode === 'our_vehicle' || line.freight.mode === 'pass_through') &&
          line.freight.rateOverride !== undefined && (
            <> · rate override {formatMoney(line.freight.rateOverride)}</>
          )}
        {(line.freight.mode === 'pass_through' || line.freight.mode === 'carrier') &&
          (line.freight.carrierBid !== undefined ? (
            <> · Carrier bid {formatMoney(line.freight.carrierBid)}</>
          ) : (
            <> · Carrier bid pending</>
          ))}
        {line.freight.mode === 'carrier' && line.freight.freightMarginPct !== undefined && (
          <> · freight margin {formatRatePercent(line.freight.freightMarginPct)}</>
        )}
      </div>

      <div style={{ color: COLOR.muted }}>
        {REVENUE_CATEGORY_LABELS[line.revenueCategory]} · {TAX_STATUS_LABELS[line.taxStatus]}
        {line.taxJurisdiction !== undefined && <> · {line.taxJurisdiction}</>}
      </div>

      <div style={{ color: COLOR.muted }}>
        Ship to:{' '}
        {line.deliveryAddress === undefined
          ? NO_DELIVERY_DESTINATION
          : addressText(line.deliveryAddress)}
      </div>
      <LineResults line={line} />
    </Box>
  );
}
