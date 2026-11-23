// The customer form's heading row and fields, shared by the new and edit pages.
// The heading row's Save button submits the form through the form attribute, so it needs no client script:
// apps/web/src/app/crm/customers/save-at-top.test.ts. The fields are read by apps/web/src/app/crm/customers/collect-customer.ts.
import type { ReactNode } from 'react';

import { DEFAULT_NET_DAYS, type Customer, type ResolvedSalesRep, type SalesRep } from '@erp/types';
import {
  Button,
  CheckboxLabel,
  COLOR,
  FONT_SIZE,
  Field,
  FieldLabel,
  FieldRow,
  Hint,
  Input,
  RADIUS,
  SectionNote,
  Select,
  SPACE,
} from '@erp/ui';

import { WithDorLookup } from '../../../lib/dor-lookup-link';
import { DEFAULT_TAX_JURISDICTION_HINT, SHARED_MAILBOX_HINT } from '../../../lib/helptext';
import { repOptions } from '../../../lib/sales-reps';
import {
  SAME_AS_BILLING_FIELD,
  SAME_AS_BILLING_REVEAL_CSS,
  SHIPPING_BOXES_CLASS,
  SHIPPING_FIELDSET_CLASS,
  ratioToPercent,
} from './collect-customer';
import { CUSTOMER_FORM_ID } from './customer-form-id';

export function CustomerFormHead({ title, saveLabel }: { title: string; saveLabel: string }) {
  return (
    <div style={headRow}>
      <h1 style={{ marginBottom: 0 }}>{title}</h1>
      <Button form={CUSTOMER_FORM_ID}>{saveLabel}</Button>
    </div>
  );
}

const STATE_PATTERN = '[A-Za-z]{2}';
const POSTAL_PATTERN = '[0-9]{5}(-[0-9]{4})?';

const PERCENT_PATTERN = '[0-9]+(\\.[0-9]+)?';

export function CustomerFormFields({
  customer,
  reps,
  storedRep,
  forQuote = false,
  echo = {},
}: {
  customer?: Customer;

  reps: readonly SalesRep[];

  storedRep?: ResolvedSalesRep;

  forQuote?: boolean;

  echo?: Record<string, string>;
}) {
  const terms = customer?.paymentTerms;
  const address = customer?.billingAddress;
  const shipTo = customer?.shippingAddress;
  const repChoices = repOptions(reps, storedRep);

  const shown = (field: string, stored?: string | number): string =>
    echo[field] ?? (stored === undefined ? '' : String(stored));

  const typed = Object.keys(echo).length > 0;
  const ticked = (field: string, stored: boolean): boolean =>
    typed ? echo[field] !== undefined : stored;

  return (
    <>
      <Fieldset legend="Identity">
        <FieldRow>
          <Field>
            <FieldLabel>Customer name</FieldLabel>
            <Input
              type="text"
              name="name"
              required
              maxLength={255}
              defaultValue={shown('name', customer?.name)}
              style={{ width: 280 }}
            />
          </Field>
        </FieldRow>

        <FieldRow>
          <Field>
            <FieldLabel>Legacy account number</FieldLabel>
            <Input
              type="text"
              name="legacyAccountNumber"
              maxLength={64}
              defaultValue={shown('legacyAccountNumber', customer?.legacyAccountNumber)}
              style={{ width: 160 }}
            />

            <Hint>The number this account is known by in other records. Must be unique.</Hint>
          </Field>

          <Field>
            <FieldLabel>Umbrella account #</FieldLabel>
            <Input
              type="text"
              name="legacyUmbrellaAccountNumber"
              maxLength={64}
              defaultValue={shown(
                'legacyUmbrellaAccountNumber',
                customer?.legacyUmbrellaAccountNumber,
              )}
              style={{ width: 160 }}
            />
            <Hint>The parent account, where a group owns this one.</Hint>
          </Field>
        </FieldRow>

        <FieldRow>
          <Field>
            <FieldLabel>Account rep</FieldLabel>

            <Select
              name="accountRepUsername"
              defaultValue={shown('accountRepUsername', customer?.accountRepUsername)}
              style={{ width: 280 }}
            >
              <option value="">No account rep</option>
              {repChoices.map((choice) => (
                <option key={choice.value} value={choice.value}>
                  {choice.label}
                </option>
              ))}
            </Select>

            <Hint>Whose account this is. A new quote starts with them.</Hint>
          </Field>
        </FieldRow>
      </Fieldset>

      <Fieldset legend="Terms">
        <FieldRow>
          <Field>
            <FieldLabel>Net days</FieldLabel>
            <Input
              type="number"
              name="netDays"
              required
              min={1}
              max={365}
              step={1}
              defaultValue={shown('netDays', terms?.netDays ?? DEFAULT_NET_DAYS)}
              style={{ width: 100 }}
            />

            <Hint>Net 30 unless the account has agreed otherwise.</Hint>
          </Field>
        </FieldRow>
      </Fieldset>

      <Fieldset legend="Tax">
        <FieldRow>
          <WithDorLookup>
            <Field>
              <FieldLabel>Default tax jurisdiction</FieldLabel>
              <Input
                type="text"
                name="taxJurisdiction"
                maxLength={64}
                defaultValue={shown('taxJurisdiction', customer?.taxJurisdiction)}
                style={{ width: 200 }}
              />

              <Hint>{DEFAULT_TAX_JURISDICTION_HINT}</Hint>
            </Field>
          </WithDorLookup>
        </FieldRow>

        <FieldRow>
          <CheckboxLabel>
            <input
              type="checkbox"
              name="taxExempt"
              defaultChecked={ticked('taxExempt', customer?.taxExempt ?? false)}
            />
            Tax exempt
          </CheckboxLabel>
          <CheckboxLabel>
            <input
              type="checkbox"
              name="reseller"
              defaultChecked={ticked('reseller', customer?.reseller ?? false)}
            />
            Reseller
          </CheckboxLabel>
        </FieldRow>

        <FieldRow>
          <Field>
            <FieldLabel>Exemption document reference</FieldLabel>
            <Input
              type="text"
              name="taxExemptionDocRef"
              maxLength={255}
              defaultValue={shown('taxExemptionDocRef', customer?.taxExemptionDocRef)}
              style={{ width: 280 }}
            />

            <Hint>Where the certificate is filed.</Hint>
          </Field>
        </FieldRow>
      </Fieldset>

      <Fieldset legend="Freight">
        <FieldRow>
          <Field>
            <FieldLabel>Freight margin (%)</FieldLabel>
            <Input
              type="text"
              inputMode="decimal"
              name="freightMarginPct"
              pattern={PERCENT_PATTERN}
              placeholder="12"

              defaultValue={shown(
                'freightMarginPct',
                customer?.freightMarginPct === undefined
                  ? undefined
                  : ratioToPercent(customer.freightMarginPct),
              )}
              style={{ width: 100 }}
            />

            <Hint>Freight shipments only. 12 means 12 percent. Most accounts have none.</Hint>
          </Field>
        </FieldRow>
      </Fieldset>

      <Fieldset legend="Billing address">
        <SectionNote>Where the bill goes. Not a ship-to; a PO Box is fine here.</SectionNote>

        <FieldRow>
          <Field>
            <FieldLabel>Bill-to name (if different from the customer)</FieldLabel>
            <Input
              type="text"
              name="billingName"
              maxLength={120}
              placeholder="Accounts Payable"
              defaultValue={shown('billingName', address?.name)}
              style={{ width: 280 }}
            />
          </Field>
        </FieldRow>

        <FieldRow>
          <Field>
            <FieldLabel>Street or PO Box</FieldLabel>
            <Input
              type="text"
              name="billingLine1"
              required={forQuote}
              maxLength={200}
              defaultValue={shown('billingLine1', address?.line1)}
              style={{ width: 280 }}
            />
          </Field>

          <Field>
            <FieldLabel>Second line</FieldLabel>
            <Input
              type="text"
              name="billingLine2"
              maxLength={200}
              defaultValue={shown('billingLine2', address?.line2)}
              style={{ width: 200 }}
            />
          </Field>
        </FieldRow>

        <FieldRow>
          <Field>
            <FieldLabel>City</FieldLabel>
            <Input
              type="text"
              name="billingCity"
              required={forQuote}
              maxLength={120}
              defaultValue={shown('billingCity', address?.city)}
              style={{ width: 200 }}
            />
          </Field>

          <Field>
            <FieldLabel>State</FieldLabel>
            <Input
              type="text"
              name="billingState"
              required={forQuote}
              maxLength={2}
              pattern={STATE_PATTERN}
              placeholder="ID"
              defaultValue={shown('billingState', address?.state)}
              style={{ width: 70 }}
            />
          </Field>

          <Field>
            <FieldLabel>ZIP</FieldLabel>
            <Input
              type="text"
              name="billingPostalCode"
              required={forQuote}
              maxLength={10}
              pattern={POSTAL_PATTERN}
              placeholder="83010"
              defaultValue={shown('billingPostalCode', address?.postalCode)}
              style={{ width: 110 }}
            />

            <Hint>ZIP or ZIP+4.</Hint>
          </Field>
        </FieldRow>

        <SectionNote>
          {forQuote
            ? 'Required here. A customer with no billing address cannot be quoted.'
            : 'Leave all six blank for no billing address.'}
        </SectionNote>
      </Fieldset>

      {forQuote && (
        <Fieldset legend="Contact">
          <SectionNote>
            Who the quote is emailed to. Tags can be changed on the customer&apos;s page afterwards.
          </SectionNote>

          <FieldRow>
            <Field>
              <FieldLabel>Contact name</FieldLabel>

              <Input
                type="text"
                name="contactName"
                defaultValue={shown('contactName')}
                style={{ width: 280 }}
              />
              <Hint>{SHARED_MAILBOX_HINT}</Hint>
            </Field>

            <Field>
              <FieldLabel>Email</FieldLabel>
              <Input
                type="email"
                name="contactEmail"
                required
                defaultValue={shown('contactEmail')}
                style={{ width: 280 }}
              />
              <Hint>A quote cannot be sent to an account with nobody to email.</Hint>
            </Field>
          </FieldRow>
        </Fieldset>
      )}

      <Fieldset legend="Shipping address" className={SHIPPING_FIELDSET_CLASS}>
        <SectionNote>Where goods normally go. Each new quote line starts from this.</SectionNote>

        <style>{SAME_AS_BILLING_REVEAL_CSS}</style>
        <Field>
          <CheckboxLabel>
            <input
              type="checkbox"
              name={SAME_AS_BILLING_FIELD}
              defaultChecked={ticked(SAME_AS_BILLING_FIELD, false)}
            />
            Same as billing
          </CheckboxLabel>
          <Hint>
            {customer === undefined
              ? 'Saving copies the billing address here, and later billing changes do not follow.'
              : 'Ticked, saving overwrites the shipping address with a copy of the billing address.'}
          </Hint>
        </Field>

        <div className={SHIPPING_BOXES_CLASS}>
          <div style={shippingBoxes}>
            <FieldRow>
              <Field>
                <FieldLabel>Ship-to name</FieldLabel>
                <Input
                  type="text"
                  name="shippingName"
                  maxLength={120}
                  placeholder="Receiving warehouse"
                  defaultValue={shown('shippingName', shipTo?.name)}
                  style={{ width: 280 }}
                />
                <Hint>A site or warehouse, not the legal name.</Hint>
              </Field>
            </FieldRow>

            <FieldRow>
              <Field>
                <FieldLabel>Street</FieldLabel>
                <Input
                  type="text"
                  name="shippingLine1"
                  maxLength={200}
                  defaultValue={shown('shippingLine1', shipTo?.line1)}
                  style={{ width: 280 }}
                />

                <Hint>A street address. Freight cannot go to a PO Box.</Hint>
              </Field>

              <Field>
                <FieldLabel>Second line</FieldLabel>
                <Input
                  type="text"
                  name="shippingLine2"
                  maxLength={200}
                  defaultValue={shown('shippingLine2', shipTo?.line2)}
                  style={{ width: 200 }}
                />
              </Field>
            </FieldRow>

            <FieldRow>
              <Field>
                <FieldLabel>City</FieldLabel>
                <Input
                  type="text"
                  name="shippingCity"
                  maxLength={120}
                  defaultValue={shown('shippingCity', shipTo?.city)}
                  style={{ width: 200 }}
                />
              </Field>

              <Field>
                <FieldLabel>State</FieldLabel>
                <Input
                  type="text"
                  name="shippingState"
                  maxLength={2}
                  placeholder="ID"
                  defaultValue={shown('shippingState', shipTo?.state)}
                  style={{ width: 70 }}
                />
              </Field>

              <Field>
                <FieldLabel>ZIP</FieldLabel>
                <Input
                  type="text"
                  name="shippingPostalCode"
                  maxLength={10}
                  placeholder="83010"
                  defaultValue={shown('shippingPostalCode', shipTo?.postalCode)}
                  style={{ width: 110 }}
                />
                <Hint>ZIP or ZIP+4.</Hint>
              </Field>
            </FieldRow>

            <SectionNote>Leave all six blank for no shipping address.</SectionNote>
          </div>
        </div>
      </Fieldset>
    </>
  );
}

function Fieldset({
  legend,
  className,
  children,
}: {
  legend: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <fieldset className={className} style={fieldset}>
      <legend style={{ fontSize: FONT_SIZE.sm, color: COLOR.muted }}>{legend}</legend>
      {children}
    </fieldset>
  );
}

const headRow = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'baseline',
  gap: SPACE.xl,
  flexWrap: 'wrap',
} as const;

const shippingBoxes = { display: 'grid', gap: SPACE.md } as const;

const fieldset = {
  border: `1px solid ${COLOR.border}`,
  borderRadius: RADIUS,
  padding: '0.5rem 0.75rem 0.75rem',
  display: 'grid',
  gap: SPACE.md,
  margin: 0,
} as const;
