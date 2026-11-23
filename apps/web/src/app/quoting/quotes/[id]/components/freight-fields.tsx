// The freight boxes of a line: rate override, carrier bid and freight margin. Which boxes a mode reads is in line-defaults.ts.
import { Fragment, type ReactNode } from 'react';

import { Field, FieldLabel, FieldRow, Hint, Input } from '@erp/ui';

import {
  CARRIER_BID_HINT,
  FREIGHT_MARGIN_PERCENT_HINT,
  RATE_OVERRIDE_HINT,
} from '../../../../../lib/helptext';
import { PERCENT_PATTERN } from '../../../../../lib/percent';
import {
  FREIGHT_BOX_CLASS,
  FREIGHT_BOX_ORDER,
  FREIGHT_FIELD,
  FREIGHT_ROW_CLASS,
  type FreightBox,
  type FreightValues,
} from '../line-defaults';

const MONEY_PATTERN = '\\d+(\\.\\d{1,4})?';

export function FreightFields({
  index,
  values,
  boxes,
  reveal = false,
}: {
  index: number;
  values: FreightValues;
  boxes: Readonly<Record<FreightBox, boolean>>;
  reveal?: boolean;
}) {
  const fields: Record<FreightBox, ReactNode> = {
    rateOverride: (
      <Field>
        <FieldLabel>Rate override ($)</FieldLabel>
        <Input
          type="text"
          inputMode="decimal"
          pattern={MONEY_PATTERN}
          name={`lines[${index}].${FREIGHT_FIELD.rateOverride}`}
          defaultValue={values.rateOverride}
          style={{ width: 110 }}
        />
        <Hint>{RATE_OVERRIDE_HINT}</Hint>
      </Field>
    ),
    carrierBid: (
      <Field>
        <FieldLabel>Carrier bid ($)</FieldLabel>
        <Input
          type="text"
          inputMode="decimal"
          pattern={MONEY_PATTERN}
          name={`lines[${index}].${FREIGHT_FIELD.carrierBid}`}
          defaultValue={values.carrierBid}
          style={{ width: 110 }}
        />
        <Hint>{CARRIER_BID_HINT}</Hint>
      </Field>
    ),
    freightMargin: (
      <Field>
        <FieldLabel>Freight margin (%)</FieldLabel>

        <Input
          type="text"
          inputMode="decimal"
          pattern={PERCENT_PATTERN}
          name={`lines[${index}].${FREIGHT_FIELD.freightMargin}`}
          defaultValue={values.freightMargin}
          style={{ width: 110 }}
        />
        <Hint>{FREIGHT_MARGIN_PERCENT_HINT}</Hint>
      </Field>
    ),
  };
  const row = (
    <FieldRow>
      {FREIGHT_BOX_ORDER.filter((box) => boxes[box]).map((box) =>
        reveal ? (
          <div key={box} className={FREIGHT_BOX_CLASS[box]}>
            {fields[box]}
          </div>
        ) : (
          <Fragment key={box}>{fields[box]}</Fragment>
        ),
      )}
    </FieldRow>
  );
  return reveal ? <div className={FREIGHT_ROW_CLASS}>{row}</div> : row;
}
