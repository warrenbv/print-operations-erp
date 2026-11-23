// Edit a customer's quote defaults and parts. Sales, the Billing Manager and Admin may:
// `mayWriteCustomerDefaults` in apps/web/src/lib/roles.ts. The save goes through apps/web/src/app/crm/customers/[id]/defaults/actions.ts.
import { Fragment } from 'react';

import { notFound } from 'next/navigation';

import {
  CUSTOMER_DESCRIPTION_MAX,
  CUSTOMER_PART_NUMBER_MAX,
  PRICING_BASES,
  SHIPPING_MODES,
  customerSchema,
  gradeLabel,
  partFor,
  type Customer,
  type Grade,
} from '@erp/types';
import {
  Button,
  CheckboxLabel,
  COLOR,
  ErrorBanner,
  Field,
  FieldLabel,
  FieldRow,
  Hint,
  Input,
  PageLede,
  PageShell,
  Section,
  Select,
  SPACE,
} from '@erp/ui';

import { agreedPriceLine } from '../../../../../../lib/agreed-price';
import { loadCustomerDefaults } from '../../../../../../lib/customer-defaults';
import { fetchParsed } from '../../../../../../lib/fetch-parsed';
import { submitted } from '../../../../../../lib/form-echo';
import { ONLY_SALES_OR_BILLING_SETS_QUOTE_DEFAULTS } from '../../../../../../lib/helptext';
import { loadMe } from '../../../../../../lib/load-me';
import { POSITIVE_MEASURE_PATTERN } from '../../../../../../lib/measures';
import { mayWriteCustomerDefaults } from '../../../../../../lib/roles';
import { PRICING_BASIS_LABELS, SHIPPING_MODE_LABELS } from '../../../../../quoting/format';
import { loadGrades } from '../../../../../quoting/load-grades';
import { loadTiers } from '../../../../../quoting/load-tiers';
import { saveCustomerDefaultsAction } from '../actions';
import { defaultsFormStart, partField, type PartRowStart } from '../collect-defaults';
import { recordTitle } from '../../../../../../lib/record-title';

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

async function loadCustomer(id: string): Promise<Customer | 'not-found'> {
  const customer = await fetchParsed(`/crm/customers/${encodeURIComponent(id)}`, customerSchema, {
    notFound: 'null',
  });
  return customer ?? 'not-found';
}

export async function generateMetadata({ params }: PageProps) {
  const { id } = await params;
  const title = await recordTitle(
    `/crm/customers/${encodeURIComponent(id)}`,
    customerSchema,
    (customer) => `${customer.name}: quote defaults`,
    'Quote defaults',
  );
  return { title };
}

export default async function EditCustomerDefaultsPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const query = await searchParams;
  const error = typeof query['error'] === 'string' ? query['error'] : undefined;

  const me = await loadMe();
  if (me === null) {
    return (
      <PageShell>
        <h1>Quote defaults</h1>
        <p>
          <a href="/login" style={{ color: COLOR.accent }}>
            Sign in
          </a>{' '}
          to view this page.
        </p>
      </PageShell>
    );
  }

  const result = await loadCustomer(id);
  if (result === 'not-found') {
    notFound();
  }
  const customer = result;

  if (!mayWriteCustomerDefaults(me.roles)) {
    return (
      <PageShell>
        <h1>{customer.name}: quote defaults</h1>
        <PageLede>{ONLY_SALES_OR_BILLING_SETS_QUOTE_DEFAULTS}</PageLede>
        <BackLink id={id} />
      </PageShell>
    );
  }

  const [defaults, grades, tiers] = await Promise.all([
    loadCustomerDefaults(id),
    loadGrades(),
    loadTiers(),
  ]);
  const echo = submitted(query);
  const start = defaultsFormStart(defaults, echo);

  const tierListed = start.tierCode === '' || tiers.some((tier) => tier.code === start.tierCode);

  // A form redrawn after a validation error keeps the `lockVersion` it was first drawn at, so the
  // resubmit is still refused if someone saved meanwhile: docs/decisions/006-optimistic-concurrency.md.
  const drawnAt =
    typeof query['drawnAt'] === 'string' && Object.keys(echo).length > 0
      ? query['drawnAt']
      : String(defaults.lockVersion);

  return (
    <PageShell>
      <h1>{customer.name}: quote defaults</h1>
      <PageLede>
        How a new quote for this customer starts. Sales can change any of them on the quote.
      </PageLede>
      <BackLink id={id} />

      <ErrorBanner message={error} />

      <form action={saveCustomerDefaultsAction} style={formStyle}>
        <input type="hidden" name="customerId" value={customer.id} />

        <input type="hidden" name="lockVersion" value={drawnAt} />

        <FieldRow>
          <Field>
            <FieldLabel>Priced</FieldLabel>
            <Select name="pricingBasis" defaultValue={start.pricingBasis}>
              <option value="">No default</option>
              {PRICING_BASES.map((basis) => (
                <option key={basis} value={basis}>
                  {PRICING_BASIS_LABELS[basis]}
                </option>
              ))}
            </Select>
          </Field>

          <Field>
            <FieldLabel>Pricing tier</FieldLabel>
            <Select name="tierCode" defaultValue={start.tierCode}>
              <option value="">No default</option>
              {!tierListed && <option value={start.tierCode}>Tier no longer listed</option>}
              {tiers.map((tier) => (
                <option key={tier.id} value={tier.code}>
                  {tier.name}
                </option>
              ))}
            </Select>
            <Hint>
              A new quote line starts on this tier instead of the volume tier. Needs no approval.
            </Hint>
          </Field>

          <Field>
            <FieldLabel>Shipping</FieldLabel>
            <Select name="freightMode" defaultValue={start.freightMode}>
              <option value="">No default</option>
              {SHIPPING_MODES.map((mode) => (
                <option key={mode} value={mode}>
                  {SHIPPING_MODE_LABELS[mode]}
                </option>
              ))}
            </Select>
          </Field>

          <Field>
            <FieldLabel>Lead time (days)</FieldLabel>
            <Input
              type="number"
              name="leadTimeDays"
              min={0}
              max={3650}
              step={1}
              defaultValue={start.leadTimeDays}
              style={{ width: '7rem' }}
            />
            <Hint>Blank means no default. 0 means same day.</Hint>
          </Field>
        </FieldRow>

        <Section
          title="Parts"
          note="A new quote line on the same paper and width takes these names, and the roll length when one is set."
        >
          <div style={{ display: 'grid', gap: SPACE.md }}>
            {start.parts.map((row, i) => {
              const agreed =
                row.gradeId === ''
                  ? undefined
                  : partFor(defaults.parts, row.gradeId, Number(row.rollWidthIn))?.agreedPrice;
              return (
                <Fragment key={i}>
                  <PartRow
                    index={i}
                    row={row}
                    grades={grades}
                    isBlank={i === start.parts.length - 1}
                  />
                  {agreed !== undefined && (
                    <Hint>
                      {agreedPriceLine(agreed)}. Set by the Billing Manager on the customer page.
                    </Hint>
                  )}
                </Fragment>
              );
            })}
          </div>
        </Section>

        <div style={{ display: 'flex', gap: SPACE.md }}>
          <Button variant="primary">Save defaults</Button>
          <a
            href={`/crm/customers/${encodeURIComponent(id)}`}
            style={{ color: COLOR.accent, alignSelf: 'center' }}
          >
            Cancel
          </a>
        </div>
      </form>
    </PageShell>
  );
}

function PartRow({
  index,
  row,
  grades,
  isBlank,
}: {
  index: number;
  row: PartRowStart;
  grades: readonly Grade[];

  isBlank: boolean;
}) {
  const listed = row.gradeId === '' || grades.some((grade) => grade.id === row.gradeId);
  return (
    <FieldRow align="end">
      <Field>
        <FieldLabel>{isBlank ? 'New part: paper' : 'Paper'}</FieldLabel>
        <Select name={partField(index, 'gradeId')} defaultValue={row.gradeId}>
          <option value="">—</option>

          {!listed && <option value={row.gradeId}>Paper no longer listed</option>}
          {grades.map((grade) => (
            <option key={grade.id} value={grade.id}>
              {gradeLabel(grade)}
            </option>
          ))}
        </Select>
      </Field>
      <Field>
        <FieldLabel>Width (in)</FieldLabel>

        <Input
          type="number"
          name={partField(index, 'rollWidthIn')}
          min={1}
          max={1000}
          step="any"
          defaultValue={row.rollWidthIn}
          style={{ width: '6rem' }}
        />
      </Field>

      <Field>
        <FieldLabel>Roll length (ft)</FieldLabel>
        <Input
          type="text"
          inputMode="decimal"
          pattern={POSITIVE_MEASURE_PATTERN}
          name={partField(index, 'feetPerRoll')}
          defaultValue={row.feetPerRoll}
          style={{ width: '7rem' }}
        />
      </Field>
      <Field>
        <FieldLabel>Customer part number</FieldLabel>
        <Input
          type="text"
          name={partField(index, 'partNumber')}
          defaultValue={row.partNumber}
          maxLength={CUSTOMER_PART_NUMBER_MAX}
          style={{ width: 160 }}
        />
      </Field>
      <Field>
        <FieldLabel>Customer description</FieldLabel>
        <Input
          type="text"
          name={partField(index, 'description')}
          defaultValue={row.description}
          maxLength={CUSTOMER_DESCRIPTION_MAX}
          style={{ width: 260 }}
        />
      </Field>
      {!isBlank && (
        <CheckboxLabel align="bottom">
          <input type="checkbox" name={partField(index, 'remove')} defaultChecked={row.remove} />{' '}
          Remove on save
        </CheckboxLabel>
      )}
    </FieldRow>
  );
}

function BackLink({ id }: { id: string }) {
  return (
    <p style={{ marginBottom: SPACE.md }}>
      <a href={`/crm/customers/${encodeURIComponent(id)}`} style={{ color: COLOR.accent }}>
        ← Back to profile
      </a>
    </p>
  );
}

const formStyle = { display: 'grid', gap: SPACE.lg, marginTop: SPACE.xl } as const;
