// The fields of one open line on the Lines step, with rarely needed ones under More options:
// docs/product/requirements.md (R3). Starting values come from apps/web/src/app/quoting/quotes/[id]/line-defaults.ts.
import {
  CUSTOMER_DESCRIPTION_MAX,
  CUSTOMER_PART_NUMBER_MAX,
  PRICING_BASES,
  SHIPPING_MODES,
  TAX_STATUSES,
  formatWidthIn,
  type Grade,
  type PostalAddress,
  type PricingTier,
  type QuoteLine,
  type StoredCustomerPart,
  type TaxStatus,
} from '@erp/types';
import {
  Button,
  CheckboxLabel,
  Field,
  FieldLabel,
  FieldRow,
  Fold,
  Hint,
  Input,
  Select,
} from '@erp/ui';

import { agreedPriceHint } from '../../../../../lib/agreed-price';
import { WithDorLookup } from '../../../../../lib/dor-lookup-link';
import { WASHINGTON_JURISDICTION_HINT } from '../../../../../lib/helptext';
import { formatFeet, POSITIVE_MEASURE_PATTERN } from '../../../../../lib/measures';
import { PRICING_BASIS_LABELS, SHIPPING_MODE_LABELS, TAX_STATUS_LABELS } from '../../../format';
import {
  ALL_FREIGHT_BOXES,
  COST_PER_TON_PATTERN,
  MARGIN_BOX_CLASS,
  MARGIN_ENTERED_CHOICE,
  MARGIN_ENTERED_LABEL,
  MARGIN_PERCENT_PATTERN,
  MARGIN_ROW_CLASS,
  OPEN_FIELD,
  PRINTED_NO_PRINT_COST_CLASS,
  PRINTED_NO_PRINT_COST_HINT,
  TAX_JURISDICTION_CLASS,
  catalogVariants,
  coreDefaults,
  deliveryTaxValues,
  freightDefaults,
  gradeLabel,
  moreOptionsOpen,
  moreOptionsSum,
  lineAsksTax,
  marginEnteredHint,
  paperGroups,
  paperValue,
  splitPaperValue,
  stepThreeHiddenValues,
  storedListed,
  storedLineValues,
  type DeliveryTaxValues,
  type RowEcho,
} from '../line-defaults';
import { chooseNewLinePaperAction } from '../actions';
import {
  CUSTOM_WIDTH_LABEL,
  CUSTOM_WIDTH_MAX,
  CUSTOM_WIDTH_MIN,
  CUSTOM_WIDTH_VALUE,
  LENGTH_CHOICE,
  customLengthChosen,
  customWidthDefaults,
} from '../custom-width';
import { agreedPriceOfRow, type LineSeed } from '../customer-seed';
import { FreightFields } from './freight-fields';

export function LineInputs({
  index,
  line,
  echo,
  grades,
  tiers,
  marginFloorPct,
  chosenPaper,
  taxSeed,
  shippingSeed,
  lineSeed = {},
  customerParts = [],
}: {
  index: number;
  line: QuoteLine | undefined;
  echo: RowEcho | undefined;
  grades: readonly Grade[];
  tiers: readonly PricingTier[];

  marginFloorPct: string;

  chosenPaper: string | undefined;
  taxSeed: { taxStatus: TaxStatus | ''; taxJurisdiction: string };

  shippingSeed: PostalAddress | undefined;

  lineSeed?: LineSeed;

  customerParts?: readonly StoredCustomerPart[];
}) {
  const echoed = coreDefaults(line, echo, lineSeed);
  const core =
    line === undefined && echoed.gradeId === '' && chosenPaper !== undefined
      ? { ...echoed, ...splitPaperValue(chosenPaper) }
      : echoed;

  const grade = core.gradeId === '' ? undefined : grades.find((g) => g.id === core.gradeId);

  const widths = grade?.widths ?? [];
  const custom = customWidthDefaults(line, echo, grade);

  const papers = paperGroups(grades);
  const currentPaper = paperValue(core.gradeId, core.footageVariant);
  const variantOptions =
    grade !== undefined
      ? grade.footages.map((f) => ({ value: f.variant, label: f.label }))
      : catalogVariants(grades);
  const stored = storedListed(line, core, grade, variantOptions, widths);

  const storedPaperListed = stored.grade && stored.variant;

  const marker = <input type="hidden" name={`lines[${index}].${OPEN_FIELD}`} value="1" />;

  const paperField = (
    <Field>
      <FieldLabel>Paper</FieldLabel>
      <Select name={`lines[${index}].paper`} defaultValue={currentPaper}>
        {line === undefined && <option value="">— add a line —</option>}
        {line !== undefined && !storedPaperListed && (
          <option value={currentPaper}>
            {`${grade === undefined ? core.gradeId : gradeLabel(grade)} — ${
              core.footageVariant
            } (as stored)`}
          </option>
        )}
        {papers.map((group) =>
          group.options.length === 0 ? (
            <option key={group.gradeId} value="" disabled>
              {`${group.label} — no variants`}
            </option>
          ) : (
            <optgroup key={group.gradeId} label={group.label}>
              {group.options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </optgroup>
          ),
        )}
      </Select>
    </Field>
  );

  const chooseWidths = line === undefined && (
    <div style={{ alignSelf: 'flex-end' }}>
      <Button formAction={chooseNewLinePaperAction}>Choose widths</Button>
    </div>
  );

  if (line === undefined && core.gradeId === '') {
    return (
      <>
        {marker}
        <FieldRow>
          {paperField}
          {chooseWidths}
        </FieldRow>
      </>
    );
  }

  const widthDefault = custom.customWidth
    ? CUSTOM_WIDTH_VALUE
    : stored.width
      ? core.rollWidthIn
      : '';
  const ownFootage = grade?.footages.find((f) => f.variant === core.footageVariant);
  const lengthCustom = customLengthChosen(echo, core.feetPerRollOverride);

  const perPound =
    core.pricingBasis === 'per_pound' ||
    core.orderedWeightLb !== '' ||
    core.overridePricePerLb !== '';

  const freight = freightDefaults(line, echo);
  const moreOptions = { ...core, ...freight };
  const deliveryTax = deliveryTaxValues(line, taxSeed, shippingSeed, echo);

  const asksTax = lineAsksTax(
    { taxStatus: deliveryTax.taxStatus, taxJurisdiction: deliveryTax.taxJurisdiction },
    line === undefined && echo !== undefined,
  );

  const agreed = agreedPriceOfRow(
    customerParts,
    core.gradeId,
    custom.customWidth ? custom.customWidthIn : core.rollWidthIn,
  );

  return (
    <>
      {marker}

      <FieldRow>
        {paperField}
        {chooseWidths}

        <div className="line-width" style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
          <Field>
            <FieldLabel>Width</FieldLabel>
            <Select name={`lines[${index}].rollWidthIn`} defaultValue={widthDefault}>
              <option value="">—</option>
              {widths.map((w) => (
                <option key={w.rollWidthIn} value={String(w.rollWidthIn)}>
                  {formatWidthIn(w.rollWidthIn)}
                </option>
              ))}
              <option value={CUSTOM_WIDTH_VALUE}>{CUSTOM_WIDTH_LABEL}</option>
            </Select>
            <Hint>Stock widths for this paper.</Hint>
          </Field>
          <div className="custom-width-box">
            <Field>
              <FieldLabel>Custom width (in)</FieldLabel>
              <Input
                type="number"
                name={`lines[${index}].customWidthIn`}
                min={CUSTOM_WIDTH_MIN}
                max={CUSTOM_WIDTH_MAX}
                step={1}
                defaultValue={custom.customWidthIn}
                style={{ width: 110 }}
              />
            </Field>
          </div>
        </div>

        <div className="line-length" style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
          <Field>
            <FieldLabel>Length per roll</FieldLabel>
            <Select
              name={`lines[${index}].lengthChoice`}
              defaultValue={lengthCustom ? LENGTH_CHOICE.custom : LENGTH_CHOICE.own}
            >
              <option value={LENGTH_CHOICE.own}>
                {ownFootage === undefined
                  ? 'The paper’s own'
                  : `${formatFeet(ownFootage.feetPerRoll)} ft (the paper’s own)`}
              </option>
              <option value={LENGTH_CHOICE.custom}>Custom length</option>
            </Select>

            {line === undefined &&
              customerParts.some(
                (part) =>
                  part.feetPerRoll !== undefined &&
                  part.gradeId.toLowerCase() === core.gradeId.toLowerCase(),
              ) && (
                <Hint>
                  Left on the paper&rsquo;s own, saves at the customer&rsquo;s length for this paper
                  and width.
                </Hint>
              )}
          </Field>
          <div className="custom-length-box">
            <Field>
              <FieldLabel>Custom length (ft)</FieldLabel>
              <Input
                type="text"
                inputMode="decimal"
                pattern={POSITIVE_MEASURE_PATTERN}
                name={`lines[${index}].feetPerRollOverride`}
                defaultValue={core.feetPerRollOverride}
                style={{ width: 130 }}
              />
            </Field>
          </div>
        </div>
      </FieldRow>

      <FieldRow>
        <Field>
          <FieldLabel>Quantity (rolls)</FieldLabel>
          <Input
            type="number"
            name={`lines[${index}].quantityRolls`}
            min={1}
            step={1}
            defaultValue={core.quantityRolls}
            style={{ width: 110 }}
          />
        </Field>

        <Field>
          <FieldLabel>Shipping</FieldLabel>
          <Select name={`lines[${index}].freightMode`} defaultValue={core.freightMode}>
            {SHIPPING_MODES.map((mode) => (
              <option key={mode} value={mode}>
                {SHIPPING_MODE_LABELS[mode]}
              </option>
            ))}
          </Select>
          <Hint>
            The mode&rsquo;s freight boxes are under More options. Pass-thru and Freight ask for a
            delivery address on step 3.
          </Hint>
        </Field>
      </FieldRow>

      {asksTax && (
        <FieldRow>
          <Field>
            <FieldLabel>Tax treatment</FieldLabel>
            <Select name={`lines[${index}].taxStatus`} defaultValue={deliveryTax.taxStatus}>
              {deliveryTax.taxStatus === '' && <option value="">— choose —</option>}
              {TAX_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {TAX_STATUS_LABELS[status]}
                </option>
              ))}
            </Select>
            <Hint>The customer&rsquo;s record does not settle this. Step 3 changes it later.</Hint>
          </Field>

          <div className={TAX_JURISDICTION_CLASS}>
            <WithDorLookup>
              <Field>
                <FieldLabel>Tax jurisdiction</FieldLabel>
                <Input
                  type="text"
                  name={`lines[${index}].taxJurisdiction`}
                  defaultValue={deliveryTax.taxJurisdiction}
                  maxLength={64}
                  style={{ width: 130 }}
                />
                <Hint>{WASHINGTON_JURISDICTION_HINT}</Hint>
              </Field>
            </WithDorLookup>
          </div>
        </FieldRow>
      )}

      <Fold
        summary="More options"
        sum={moreOptionsSum(moreOptions, tiers)}
        open={moreOptionsOpen(moreOptions)}
      >
        <FieldRow>
          <Field>
            <FieldLabel>Priced</FieldLabel>
            <Select name={`lines[${index}].pricingBasis`} defaultValue={core.pricingBasis}>
              {PRICING_BASES.map((basis) => (
                <option key={basis} value={basis}>
                  {PRICING_BASIS_LABELS[basis]}
                </option>
              ))}
            </Select>
            <Hint>Per pound prices the line on the pounds the customer ordered.</Hint>
          </Field>

          <div
            className={MARGIN_ROW_CLASS}
            style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-start' }}
          >
            <Field>
              <FieldLabel>Pricing tier</FieldLabel>
              <Select
                name={`lines[${index}].tierOverrideCode`}
                defaultValue={core.tierOverrideCode}
              >
                <option value="">Auto (by volume)</option>
                {tiers.map((t) => (
                  <option key={t.id} value={t.code}>
                    {t.name}
                  </option>
                ))}
                <option value={MARGIN_ENTERED_CHOICE}>{MARGIN_ENTERED_LABEL}</option>
              </Select>
            </Field>
            <div className={MARGIN_BOX_CLASS}>
              <Field>
                <FieldLabel>Margin (%)</FieldLabel>
                <Input
                  type="text"
                  inputMode="decimal"
                  pattern={MARGIN_PERCENT_PATTERN}
                  name={`lines[${index}].marginOverridePct`}
                  defaultValue={core.marginOverridePct}
                  style={{ width: 110 }}
                />
                <Hint>{marginEnteredHint(marginFloorPct)}</Hint>
              </Field>
            </div>
          </div>

          <Field>
            <FieldLabel>
              Hand-set price per roll <Optional />
            </FieldLabel>
            <Input
              type="text"
              inputMode="decimal"
              pattern="\d+(\.\d{1,4})?"
              name={`lines[${index}].overridePricePerRoll`}
              defaultValue={core.overridePricePerRoll}
              style={{ width: 130 }}
            />
            <Hint>Needs the Billing Manager&rsquo;s approval before the quote can be sent.</Hint>
            {agreed?.basis === 'per_roll' && <Hint>{agreedPriceHint(agreed)}</Hint>}
          </Field>
        </FieldRow>

        {perPound && (
          <FieldRow>
            <Field>
              <FieldLabel>Pounds ordered (lb)</FieldLabel>
              <Input
                type="text"
                inputMode="decimal"
                pattern={POSITIVE_MEASURE_PATTERN}
                name={`lines[${index}].orderedWeightLb`}
                defaultValue={core.orderedWeightLb}
                style={{ width: 130 }}
              />
              <Hint>The pounds on the customer&rsquo;s PO.</Hint>
            </Field>

            <Field>
              <FieldLabel>
                Hand-set price per pound <Optional />
              </FieldLabel>
              <Input
                type="text"
                inputMode="decimal"
                pattern="\d+(\.\d{1,4})?"
                name={`lines[${index}].overridePricePerLb`}
                defaultValue={core.overridePricePerLb}
                style={{ width: 130 }}
              />
              <Hint>Needs the Billing Manager&rsquo;s approval before the quote can be sent.</Hint>
              {agreed?.basis === 'per_pound' && <Hint>{agreedPriceHint(agreed)}</Hint>}
            </Field>
          </FieldRow>
        )}

        <FreightFields index={index} values={freight} boxes={ALL_FREIGHT_BOXES} reveal />

        <FieldRow>
          <Field>
            <FieldLabel>
              Customer description <Optional />
            </FieldLabel>
            <Input
              type="text"
              name={`lines[${index}].customerDescription`}
              defaultValue={core.customerDescription}
              maxLength={CUSTOMER_DESCRIPTION_MAX}
              style={{ width: 260 }}
            />
            <Hint>The customer&rsquo;s own name for the goods.</Hint>
          </Field>

          <Field>
            <FieldLabel>
              Customer part number <Optional />
            </FieldLabel>
            <Input
              type="text"
              name={`lines[${index}].customerPartNumber`}
              defaultValue={core.customerPartNumber}
              maxLength={CUSTOMER_PART_NUMBER_MAX}
              style={{ width: 160 }}
            />

            {line === undefined &&
              customerParts.some(
                (part) => part.gradeId.toLowerCase() === core.gradeId.toLowerCase(),
              ) && (
                <Hint>
                  Left blank, fills from the customer&rsquo;s part for this paper and width.
                </Hint>
              )}
          </Field>
        </FieldRow>

        <FieldRow>
          <CheckboxLabel>
            <input type="checkbox" name={`lines[${index}].printed`} defaultChecked={core.printed} />{' '}
            Printed
          </CheckboxLabel>
          <CheckboxLabel>
            <input
              type="checkbox"
              name={`lines[${index}].overwrap`}
              defaultChecked={core.overwrap}
            />{' '}
            Overwrap
          </CheckboxLabel>
        </FieldRow>

        <FieldRow>
          <Field>
            <FieldLabel>
              Converting cost ($/US ton) <Optional />
            </FieldLabel>
            <Input
              type="text"
              inputMode="decimal"
              pattern={COST_PER_TON_PATTERN}
              name={`lines[${index}].convertCostPerTon`}
              defaultValue={core.convertCostPerTon}
              style={{ width: 130 }}
            />
          </Field>

          <Field>
            <FieldLabel>
              Print cost ($/US ton) <Optional />
            </FieldLabel>

            <Input
              type="text"
              inputMode="decimal"
              pattern={COST_PER_TON_PATTERN}
              name={`lines[${index}].printCostPerTon`}
              defaultValue={core.printCostPerTon}
              placeholder=" "
              style={{ width: 130 }}
            />

            <span className={PRINTED_NO_PRINT_COST_CLASS}>
              <Hint>{PRINTED_NO_PRINT_COST_HINT}</Hint>
            </span>
          </Field>
        </FieldRow>
      </Fold>

      <StepThreeHiddenInputs index={index} values={deliveryTax} omitTax={asksTax} />
    </>
  );
}

function StepThreeHiddenInputs({
  index,
  values,
  omitTax,
}: {
  index: number;
  values: DeliveryTaxValues;
  omitTax: boolean;
}) {
  return (
    <>
      {Object.entries(stepThreeHiddenValues(values, omitTax)).map(([field, value]) => (
        <input key={field} type="hidden" name={`lines[${index}].${field}`} value={value} />
      ))}
    </>
  );
}

function Optional() {
  return <span style={{ fontWeight: 400 }}>(optional)</span>;
}

export function StoredLineHiddenInputs({
  index,
  line,
  grade,
}: {
  index: number;
  line: QuoteLine;

  grade: Grade | undefined;
}) {
  const values = storedLineValues(line, grade);
  return (
    <>
      {Object.entries(values)
        .filter(([, value]) => value !== '')
        .map(([field, value]) => (
          <input key={field} type="hidden" name={`lines[${index}].${field}`} value={value} />
        ))}
    </>
  );
}
