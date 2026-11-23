// The Quote defaults section: how a new quote for this customer starts, and the customer's parts with any
// agreed price. Editing is on apps/web/src/app/crm/customers/[id]/defaults/edit/page.tsx.
import {
  PRICING_BASES,
  formatWidthIn,
  gradeLabel,
  type CustomerDefaults,
  type Grade,
  type PricingBasis,
  type PricingTier,
  type StoredCustomerPart,
} from '@erp/types';
import {
  Button,
  COLOR,
  DL,
  Field,
  FieldLabel,
  FieldRow,
  Fold,
  FONT_SIZE,
  Input,
  ResetList,
  Section,
  Select,
  SPACE,
} from '@erp/ui';

import { agreedPriceLine } from '../../../../lib/agreed-price';
import { formatTimestamp } from '../../../../lib/dates';
import { ONLY_SALES_OR_BILLING_SETS_QUOTE_DEFAULTS } from '../../../../lib/helptext';
import { formatFeet } from '../../../../lib/measures';
import { PRICING_BASIS_LABELS, SHIPPING_MODE_LABELS } from '../../../quoting/format';
import { leadTimeLabel } from '../../../quoting/quotes/[id]/derive';
import { setAgreedPriceAction } from './agreed-price-actions';
import { AGREED_PRICE_PATTERN, REMOVE_AGREED_PRICE_FIELD } from './agreed-price';

function None() {
  return <em style={{ color: COLOR.muted }}>None</em>;
}

export function DefaultsSection({
  customerId,
  defaults,
  grades,
  tiers,
  canWrite,
  canSetAgreedPrice = false,
}: {
  customerId: string;
  defaults: CustomerDefaults;
  grades: readonly Grade[];

  tiers: readonly Pick<PricingTier, 'code' | 'name'>[];
  canWrite: boolean;

  canSetAgreedPrice?: boolean;
}) {
  const gradeById = new Map(grades.map((grade) => [grade.id.toLowerCase(), grade]));
  const tier = tiers.find((t) => t.code === defaults.tierCode);
  return (
    <Section
      title="Quote defaults"
      note={
        canWrite
          ? 'A new quote for this customer starts with these, and Sales can change any of them there.'
          : ONLY_SALES_OR_BILLING_SETS_QUOTE_DEFAULTS
      }
    >
      <DL>
        <dt>Priced</dt>
        <dd>
          {defaults.pricingBasis === undefined ? (
            <None />
          ) : (
            PRICING_BASIS_LABELS[defaults.pricingBasis]
          )}
        </dd>

        <dt>Pricing tier</dt>
        <dd>
          {defaults.tierCode === undefined ? <None /> : (tier?.name ?? 'Tier no longer listed')}
        </dd>
        <dt>Shipping</dt>
        <dd>
          {defaults.freightMode === undefined ? (
            <None />
          ) : (
            SHIPPING_MODE_LABELS[defaults.freightMode]
          )}
        </dd>

        <dt>Lead time</dt>
        <dd>
          {defaults.leadTimeDays === undefined ? <None /> : leadTimeLabel(defaults.leadTimeDays)}
        </dd>

        <dt>Parts</dt>
        <dd>
          {defaults.parts.length === 0 ? (
            <None />
          ) : (
            <ResetList gap={SPACE.xs}>
              {defaults.parts.map((part) => {
                const grade = gradeById.get(part.gradeId.toLowerCase());
                return (
                  <li key={`${part.gradeId}|${String(part.rollWidthIn)}`}>
                    {grade === undefined ? 'Paper no longer listed' : gradeLabel(grade)} ·{' '}
                    {formatWidthIn(part.rollWidthIn)}
                    {part.feetPerRoll !== undefined && <> · {formatFeet(part.feetPerRoll)} ft</>}
                    {part.partNumber !== undefined && <> · {part.partNumber}</>}
                    {part.description !== undefined && <> · {part.description}</>}
                    {part.agreedPrice !== undefined && (
                      <span style={{ display: 'block', color: COLOR.muted }}>
                        {agreedPriceLine(part.agreedPrice)}
                      </span>
                    )}
                    {canSetAgreedPrice && (
                      <AgreedPriceFold
                        customerId={customerId}
                        lockVersion={defaults.lockVersion}
                        part={part}
                        basis={part.agreedPrice?.basis ?? defaults.pricingBasis ?? 'per_roll'}
                      />
                    )}
                  </li>
                );
              })}
            </ResetList>
          )}
        </dd>
      </DL>

      {defaults.updatedBy !== undefined && defaults.updatedAt !== undefined && (
        <p style={{ color: COLOR.muted, fontSize: FONT_SIZE.sm, marginTop: SPACE.md }}>
          Last saved by {defaults.updatedBy}, {formatTimestamp(defaults.updatedAt)}.
        </p>
      )}

      {canWrite && (
        <p style={{ marginTop: SPACE.md }}>
          <a
            href={`/crm/customers/${encodeURIComponent(customerId)}/defaults/edit`}
            style={{ color: COLOR.accent }}
          >
            Edit quote defaults
          </a>
        </p>
      )}
    </Section>
  );
}

function AgreedPriceFold({
  customerId,
  lockVersion,
  part,
  basis,
}: {
  customerId: string;
  lockVersion: number;
  part: StoredCustomerPart;

  basis: PricingBasis;
}) {
  const hidden = (
    <>
      <input type="hidden" name="customerId" value={customerId} />

      <input type="hidden" name="lockVersion" value={lockVersion} />
      <input type="hidden" name="gradeId" value={part.gradeId} />
      <input type="hidden" name="rollWidthIn" value={String(part.rollWidthIn)} />
    </>
  );
  return (
    <div style={{ marginTop: SPACE.xs }}>
      <Fold summary="Set the agreed price">
        <form action={setAgreedPriceAction}>
          {hidden}
          <FieldRow align="end">
            <Field>
              <FieldLabel>Priced</FieldLabel>
              <Select name="basis" defaultValue={basis}>
                {PRICING_BASES.map((basis) => (
                  <option key={basis} value={basis}>
                    {PRICING_BASIS_LABELS[basis]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field>
              <FieldLabel>Agreed price ($)</FieldLabel>
              <Input
                type="text"
                inputMode="decimal"
                pattern={AGREED_PRICE_PATTERN}
                name="price"
                defaultValue={part.agreedPrice?.price ?? ''}
                style={{ width: 130 }}
              />
            </Field>
            <div style={{ alignSelf: 'flex-end' }}>
              <Button variant="primary">Save agreed price</Button>
            </div>
          </FieldRow>
        </form>
        {part.agreedPrice !== undefined && (
          <form action={setAgreedPriceAction} style={{ marginTop: SPACE.sm }}>
            {hidden}
            <input type="hidden" name={REMOVE_AGREED_PRICE_FIELD} value="1" />
            <Button>Remove the agreed price</Button>
          </form>
        )}
      </Fold>
    </div>
  );
}
