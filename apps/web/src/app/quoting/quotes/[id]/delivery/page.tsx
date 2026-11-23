// Step 3, Delivery and tax: each line's shipping, tax treatment and delivery address: docs/product/requirements.md (R4).
// The form is read by apps/web/src/app/quoting/quotes/[id]/collect-delivery.ts.
import { notFound, redirect } from 'next/navigation';

import {
  REVENUE_CATEGORIES,
  TAX_STATUSES,
  formatMoney,
  formatRatePercent,
  freightInRollPriceApplies,
  quoteReference,
  quoteWithLinesSchema,
  type Customer,
  type Grade,
  type QuoteLine,
} from '@erp/types';
import {
  Button,
  CheckboxLabel,
  COLOR,
  DataLine,
  DL,
  ErrorBanner,
  Field,
  FieldLabel,
  FieldRow,
  FONT_SIZE,
  Hint,
  InfoBanner,
  Input,
  LinkButton,
  MEASURE,
  PageLede,
  PageShell,
  RADIUS,
  SectionNote,
  Select,
  SPACE,
  StatusChip,
  StepStrip,
} from '@erp/ui';

import { NO_DELIVERY_DESTINATION, addressText } from '../../../../../lib/address';
import { WithDorLookup } from '../../../../../lib/dor-lookup-link';
import { submitted } from '../../../../../lib/form-echo';
import { onlyDesk, WASHINGTON_JURISDICTION_HINT } from '../../../../../lib/helptext';
import { loadMe } from '../../../../../lib/load-me';
import { recordTitle } from '../../../../../lib/record-title';
import { UNKNOWN_CUSTOMER } from '../../../customer-names';
import { QUOTE_STATUS_LABELS, REVENUE_CATEGORY_LABELS, TAX_STATUS_LABELS } from '../../../format';
import {
  CUSTOMER_LOCK_FIELD,
  DELIVERY_CARD_CLASS,
  EXEMPT_CUSTOMER_TAX_HINT,
  FREIGHT_IN_ROLL_PRICE_FIELD,
  FREIGHT_IN_ROLL_PRICE_HINT,
  FREIGHT_IN_ROLL_PRICE_LABEL,
  FREIGHT_IN_ROLL_PRICE_PENDING_HINT,
  FREIGHT_IN_ROLL_PRICE_PER_POUND_HINT,
  FREIGHT_IN_ROLL_PRICE_READ_ONLY,
  NON_TAXABLE_TICK_HINT,
  NON_TAX_HINT_CLASS,
  OWN_ADDRESS_CLASS,
  OWN_TAX_CLASS,
  SAME_AS_LINE_ONE_CLASS,
  SAVE_SHIPPING_FIELD,
  SAVE_SHIPPING_LABEL,
  SAVE_TAX_FIELD,
  SAVE_TAX_LABEL,
  SHIP_TO_REVEAL_CSS,
  TAX_JURISDICTION_REVEAL_CSS,
  TAX_LOOKUP_LABEL,
  TAX_TICK_CLASS,
  TAX_TICK_REVEAL_CSS,
  freightInRollPriceChecked,
  hasPerPoundLine,
  lookupFromQuery,
  offersShippingTick,
  offersTaxTick,
  onFileHint,
  taxLookupAriaLabel,
  taxLookupSentence,
  tickChecked,
  type TaxLookupResult,
} from '../collect-delivery';
import { FreightFields } from '../components/freight-fields';
import { LineSummary, lineSummaryOf } from '../components/line-summary';
import { ApprovalRevokeWarning } from '../components/save-and-price';
import { StepsHeader } from '../components/steps-header';
import {
  approvalLive as isApprovalLive,
  canWrite as roleCanWrite,
  editable as isEditable,
  showsLinesStep,
} from '../derive';
import {
  SAME_AS_LINE_ONE_NOTE,
  SHIP_TO_CHOICES,
  SHIP_TO_FIELD,
  SHIP_TO_LABELS,
  TAX_JURISDICTION_CLASS,
  deliveryTaxValues,
  firstLine,
  freightBoxes,
  freightDefaults,
  lineOneSavedAddress,
  rowEcho,
  shipToStart,
} from '../line-defaults';
import { loadCustomer, loadGrades, loadQuote, loadTotals } from '../loaders';
import { quoteStrip } from '../record';
import { quoteSteps, stepHrefs } from '../steps';
import { lookUpTaxCodeAction, saveDeliveryAction } from './actions';
import { DeliveryAddressFields } from './delivery-address-fields';

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    error?: string;
    notice?: string;

    [key: string]: string | string[] | undefined;
  }>;
}

export async function generateMetadata({ params }: PageProps) {
  const { id } = await params;
  const title = await recordTitle(
    `/quoting/quotes/${encodeURIComponent(id)}`,
    quoteWithLinesSchema,
    (quote) => `Delivery and tax for quote ${quoteReference(quote)}`,
    'Delivery and tax',
  );
  return { title };
}

export default async function QuoteDeliveryPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const query = await searchParams;
  const { error, notice } = query;
  const echo = submitted(query);

  const lookup = lookupFromQuery(query);

  const mePromise = loadMe();
  const wave1 = Promise.all([loadQuote(id), loadGrades()]);
  wave1.catch(() => {});
  const me = await mePromise;
  if (me === null) {
    return (
      <PageShell>
        <h1>Delivery and tax</h1>
        <p>
          <a href="/login" style={{ color: COLOR.accent }}>
            Sign in
          </a>{' '}
          to view this page.
        </p>
      </PageShell>
    );
  }

  const [quoteResult, grades] = await wave1;
  if (quoteResult === null) {
    notFound();
  }
  const quote = quoteResult;
  if (!showsLinesStep(quote.status)) {
    redirect(`/quoting/quotes/${quote.id}`);
  }

  const [customer, totals] = await Promise.all([loadCustomer(quote.customerId), loadTotals(id)]);

  // After a refused save the form keeps the version it was first drawn at: docs/decisions/006-optimistic-concurrency.md.
  const linesDrawnAt =
    typeof query['linesDrawnAt'] === 'string' &&
    Object.keys(echo).some((key) => key.startsWith('lines['))
      ? query['linesDrawnAt']
      : String(quote.lockVersion);

  const canWrite = roleCanWrite(me.roles);
  const editable = isEditable(me.roles, quote.status);
  const approvalLive = isApprovalLive(quote);
  const customerName = customer?.name ?? UNKNOWN_CUSTOMER;
  const hrefs = stepHrefs(quote.id);
  const gradeById = new Map(grades.map((grade) => [grade.id, grade]));

  return (
    <PageShell>
      <p style={{ margin: `0 0 ${SPACE.md}`, fontSize: FONT_SIZE.sm, color: COLOR.muted }}>
        <a href="/quoting/quotes" style={{ color: COLOR.accent }}>
          Quotes
        </a>{' '}
        /{' '}
        <a href={hrefs.lines} style={{ color: COLOR.accent }}>
          {quoteReference(quote)}
        </a>
      </p>
      <h1>
        Quote {quoteReference(quote)} for {customerName}
        <StatusChip>{QUOTE_STATUS_LABELS[quote.status]}</StatusChip>
      </h1>
      <PageLede>
        Where each line&apos;s goods go and what its tax follows. Collected lines need no address.
      </PageLede>

      <ErrorBanner message={error} />
      {notice !== undefined && <InfoBanner>{notice}</InfoBanner>}

      <StepStrip steps={quoteStrip({ quote, roles: me.roles, now: new Date() })} />
      <StepsHeader
        steps={quoteSteps({
          quoteId: quote.id,
          customerName,
          lines: quote.lines,
          openRows: 0,
          leadTimeDays: quote.leadTimeDays,
          current: 3,
        })}
      />

      {!canWrite && (
        <div style={{ marginTop: SPACE.lg }}>
          <SectionNote>{onlyDesk('Sales', "sets a quote's delivery and tax")}</SectionNote>
        </div>
      )}

      <div style={{ marginTop: SPACE.xl }}>
        {quote.lines.length === 0 ? (
          <NoLines linesHref={hrefs.lines} canWrite={canWrite} />
        ) : editable ? (
          <DeliveryForm
            quoteId={quote.id}
            lockVersion={linesDrawnAt}
            billingState={customer?.billingAddress?.state ?? ''}
            lines={quote.lines}
            gradeById={gradeById}
            echo={echo}
            linesHref={hrefs.lines}
            approvalLive={approvalLive}
            freightInRollPrice={quote.freightInRollPrice}
            customer={customer}
            lookup={lookup}
          />
        ) : (
          <DeliveryReadOnly
            lines={quote.lines}
            gradeById={gradeById}
            freightInRollPrice={freightInRollPriceApplies(quote.freightInRollPrice, quote.lines)}
          />
        )}
      </div>

      <Runbar
        pricedLines={quote.lines.length}
        extendedPrice={formatMoney(totals.extendedPrice)}
        backHref={hrefs.lines}
        continueHref={hrefs.review}
      />
    </PageShell>
  );
}

function NoLines({ linesHref, canWrite }: { linesHref: string; canWrite: boolean }) {
  return (
    <div style={{ display: 'grid', gap: SPACE.md, justifyItems: 'start' }}>
      <h2 style={{ margin: 0, fontSize: FONT_SIZE.md }}>No lines yet</h2>
      <p style={{ margin: 0, color: COLOR.muted }}>
        Price a line on step 2 before saying where it goes.
      </p>
      {canWrite && <LinkButton href={linesHref}>Add a line</LinkButton>}
    </div>
  );
}

function DeliveryForm({
  quoteId,
  lockVersion,
  billingState,
  lines,
  gradeById,
  echo,
  linesHref,
  approvalLive,
  freightInRollPrice,
  customer,
  lookup,
}: {
  quoteId: string;
  lockVersion: string;
  billingState: string;
  lines: readonly QuoteLine[];
  gradeById: ReadonlyMap<string, Grade>;
  echo: Readonly<Record<string, string>>;
  linesHref: string;
  approvalLive: boolean;

  freightInRollPrice: boolean;

  customer: Customer | null;

  lookup: { readonly index: number; readonly result: TaxLookupResult } | undefined;
}) {
  const first = firstLine(lines);
  return (
    <form action={saveDeliveryAction} style={{ display: 'grid', gap: SPACE.lg }}>
      {/* eslint-disable-next-line no-restricted-syntax -- intentional */}
      <button type="submit" tabIndex={-1} aria-hidden="true" style={OUT_OF_SIGHT}>
        Save delivery and tax
      </button>
      <input type="hidden" name="quoteId" value={quoteId} />
      <input type="hidden" name="lockVersion" value={lockVersion} />

      <input type="hidden" name="billingState" value={billingState} />

      {customer !== null && (
        <input type="hidden" name={CUSTOMER_LOCK_FIELD} value={String(customer.lockVersion)} />
      )}

      <style>{TAX_TICK_REVEAL_CSS}</style>

      <style>{TAX_JURISDICTION_REVEAL_CSS}</style>

      <style>{SHIP_TO_REVEAL_CSS}</style>

      <FreightInRollPriceBox
        checked={freightInRollPriceChecked(freightInRollPrice, echo)}
        perPound={hasPerPoundLine(lines)}
        pending={lines.some((line) => line.freightResult.pending)}
      />

      {lines.map((line, i) => (
        <DeliveryCard
          key={line.id}
          index={i}
          line={line}
          grade={gradeById.get(line.gradeId)}
          echo={echo}
          linesHref={linesHref}
          first={line.id === first?.id ? undefined : first}
          customer={customer}
          lookup={lookup?.index === i ? lookup.result : undefined}
        />
      ))}

      <div style={{ display: 'flex', gap: SPACE.lg, alignItems: 'center', flexWrap: 'wrap' }}>
        <Button variant="primary">Save delivery and tax</Button>
        {approvalLive && <ApprovalRevokeWarning />}
      </div>
    </form>
  );
}

function FreightInRollPriceBox({
  checked,
  perPound,
  pending,
}: {
  checked: boolean;
  perPound: boolean;
  pending: boolean;
}) {
  return (
    <Field>
      <CheckboxLabel>
        <input
          type="checkbox"
          name={FREIGHT_IN_ROLL_PRICE_FIELD}
          defaultChecked={checked}
          disabled={perPound}
        />
        {FREIGHT_IN_ROLL_PRICE_LABEL}
      </CheckboxLabel>
      <Hint>{perPound ? FREIGHT_IN_ROLL_PRICE_PER_POUND_HINT : FREIGHT_IN_ROLL_PRICE_HINT}</Hint>
      {!perPound && pending && <Hint>{FREIGHT_IN_ROLL_PRICE_PENDING_HINT}</Hint>}
    </Field>
  );
}

function SaveTick({
  name,
  label,
  checked,
  onFile,
}: {
  name: string;
  label: string;
  checked: boolean;

  onFile: string | undefined;
}) {
  return (
    <Field>
      <CheckboxLabel>
        <input type="checkbox" name={name} defaultChecked={checked} />
        {label}
      </CheckboxLabel>
      <Hint>{onFileHint(onFile)}</Hint>
    </Field>
  );
}

const GROUP_STYLE = {
  border: `1px solid ${COLOR.border}`,
  borderRadius: RADIUS,
  padding: `${SPACE.lg} ${SPACE.xl}`,
  margin: 0,
  display: 'grid',
  gap: SPACE.lg,
  minWidth: 0,
} as const;

const LEGEND_STYLE = { fontWeight: 700, padding: `0 ${SPACE.xs}`, fontSize: FONT_SIZE.md } as const;

const OUT_OF_SIGHT = {
  position: 'absolute',
  width: 1,
  height: 1,
  margin: -1,
  padding: 0,
  border: 0,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
} as const;

function DeliveryCard({
  index,
  line,
  grade,
  echo,
  linesHref,
  first,
  customer,
  lookup,
}: {
  index: number;
  line: QuoteLine;
  grade: Grade | undefined;
  echo: Readonly<Record<string, string>>;
  linesHref: string;

  first: QuoteLine | undefined;
  customer: Customer | null;

  lookup: TaxLookupResult | undefined;
}) {
  const n = line.lineNumber;
  const row = rowEcho(echo, index);
  const values = deliveryTaxValues(line, { taxStatus: '', taxJurisdiction: '' }, undefined, row);
  const shipTo = first === undefined ? undefined : shipToStart({ line, first, row });
  const freight = freightDefaults(line, row);
  const boxes = freightBoxes(line.freight.mode);
  const asksFreight = boxes.rateOverride || boxes.carrierBid || boxes.freightMargin;

  return (
    <div id={`line-${n}`} className={DELIVERY_CARD_CLASS} style={GROUP_STYLE}>
      <LineSummary
        id={`line-${n}-row`}
        {...lineSummaryOf(line, grade)}
        edit={{ href: `${linesHref}?edit=${n}#line-${n}`, label: `Edit line ${n}` }}
      />
      <input type="hidden" name={`lines[${index}].lineId`} value={line.id} />

      <fieldset style={GROUP_STYLE}>
        <legend style={LEGEND_STYLE}>Delivery</legend>
        {first !== undefined && shipTo !== undefined && (
          <>
            <FieldRow>
              <Field>
                <FieldLabel>Ship to</FieldLabel>
                <Select name={`lines[${index}].${SHIP_TO_FIELD}`} defaultValue={shipTo}>
                  {SHIP_TO_CHOICES.map((choice) => (
                    <option key={choice} value={choice}>
                      {SHIP_TO_LABELS[choice]}
                    </option>
                  ))}
                </Select>
              </Field>
            </FieldRow>

            <div className={SAME_AS_LINE_ONE_CLASS}>
              <SectionNote>{SAME_AS_LINE_ONE_NOTE}</SectionNote>
              <DataLine>{lineOneSavedAddress(first)}</DataLine>
            </div>
          </>
        )}
        <div className={OWN_ADDRESS_CLASS}>
          <DeliveryAddressFields index={index} address={values.delivery} />
          {offersShippingTick(customer) && (
            <SaveTick
              name={`lines[${index}].${SAVE_SHIPPING_FIELD}`}
              label={SAVE_SHIPPING_LABEL}
              checked={tickChecked(echo, index, SAVE_SHIPPING_FIELD)}
              onFile={
                customer?.shippingAddress === undefined
                  ? undefined
                  : addressText(customer.shippingAddress)
              }
            />
          )}
        </div>
      </fieldset>

      <fieldset style={GROUP_STYLE}>
        <legend style={LEGEND_STYLE}>Tax and revenue</legend>
        <FieldRow>
          <div className={OWN_TAX_CLASS}>
            <Field>
              <FieldLabel>Tax treatment</FieldLabel>
              <Select name={`lines[${index}].taxStatus`} defaultValue={values.taxStatus}>
                {values.taxStatus === '' && <option value="">— choose —</option>}
                {TAX_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {TAX_STATUS_LABELS[status]}
                  </option>
                ))}
              </Select>
              <Hint>Seeded from the customer. Change it if this line books differently.</Hint>
            </Field>

            <div className={TAX_JURISDICTION_CLASS}>
              <WithDorLookup>
                <Field>
                  <FieldLabel>Tax jurisdiction</FieldLabel>
                  <Input
                    type="text"
                    name={`lines[${index}].taxJurisdiction`}
                    defaultValue={values.taxJurisdiction}
                    maxLength={64}
                    style={{ width: 130 }}
                  />
                  <Hint>{WASHINGTON_JURISDICTION_HINT}</Hint>
                </Field>

                <Button
                  formAction={lookUpTaxCodeAction.bind(null, index)}
                  ariaLabel={taxLookupAriaLabel(n)}
                >
                  {TAX_LOOKUP_LABEL}
                </Button>

                {lookup !== undefined && (
                  <div id={`line-${n}-tax-lookup`} role="status" style={{ maxWidth: MEASURE.note }}>
                    <Hint>{taxLookupSentence(lookup)}</Hint>
                  </div>
                )}
              </WithDorLookup>
            </div>
          </div>

          <Field>
            <FieldLabel>Revenue category</FieldLabel>
            <Select name={`lines[${index}].revenueCategory`} defaultValue={values.revenueCategory}>
              {REVENUE_CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {REVENUE_CATEGORY_LABELS[category]}
                </option>
              ))}
            </Select>
            <Hint>The kind of work, not the paper.</Hint>
          </Field>
        </FieldRow>

        {customer !== null && (
          <div className={OWN_TAX_CLASS}>
            {offersTaxTick(customer) ? (
              <>
                <div className={TAX_TICK_CLASS}>
                  <SaveTick
                    name={`lines[${index}].${SAVE_TAX_FIELD}`}
                    label={SAVE_TAX_LABEL}
                    checked={tickChecked(echo, index, SAVE_TAX_FIELD)}
                    onFile={customer.taxJurisdiction}
                  />
                </div>
                <div className={NON_TAX_HINT_CLASS}>
                  <Hint>{NON_TAXABLE_TICK_HINT}</Hint>
                </div>
              </>
            ) : (
              <div className={TAX_TICK_CLASS}>
                <Hint>{EXEMPT_CUSTOMER_TAX_HINT}</Hint>
              </div>
            )}
          </div>
        )}
      </fieldset>

      {asksFreight && (
        <fieldset style={GROUP_STYLE}>
          <legend style={LEGEND_STYLE}>Freight</legend>

          <FreightFields index={index} values={freight} boxes={boxes} />
        </fieldset>
      )}
    </div>
  );
}

function DeliveryReadOnly({
  lines,
  gradeById,
  freightInRollPrice,
}: {
  lines: readonly QuoteLine[];
  gradeById: ReadonlyMap<string, Grade>;

  freightInRollPrice: boolean;
}) {
  return (
    <div style={{ display: 'grid', gap: SPACE.lg }}>
      {freightInRollPrice && <p style={{ margin: 0 }}>{FREIGHT_IN_ROLL_PRICE_READ_ONLY}</p>}
      {lines.map((line) => {
        const { freight } = line;
        return (
          <div key={line.id} id={`line-${line.lineNumber}`} style={GROUP_STYLE}>
            <LineSummary
              id={`line-${line.lineNumber}-row`}
              {...lineSummaryOf(line, gradeById.get(line.gradeId))}
              edit={undefined}
            />
            <DL>
              <dt>Ship to</dt>
              <dd>
                {line.deliveryAddress === undefined
                  ? NO_DELIVERY_DESTINATION
                  : addressText(line.deliveryAddress)}
              </dd>
              <dt>Tax</dt>
              <dd>
                {TAX_STATUS_LABELS[line.taxStatus]}
                {line.taxJurisdiction !== undefined && <> · {line.taxJurisdiction}</>}
              </dd>
              <dt>Revenue category</dt>
              <dd>{REVENUE_CATEGORY_LABELS[line.revenueCategory]}</dd>
              {(freight.mode === 'our_vehicle' || freight.mode === 'pass_through') &&
                freight.rateOverride !== undefined && (
                  <>
                    <dt>Rate override</dt>
                    <dd>{formatMoney(freight.rateOverride)}</dd>
                  </>
                )}

              {(freight.mode === 'pass_through' || freight.mode === 'carrier') && (
                <>
                  <dt>Carrier bid</dt>
                  <dd>
                    {freight.carrierBid !== undefined ? formatMoney(freight.carrierBid) : 'pending'}
                  </dd>
                </>
              )}
              {freight.mode === 'carrier' && freight.freightMarginPct !== undefined && (
                <>
                  <dt>Freight margin</dt>
                  <dd>{formatRatePercent(freight.freightMarginPct)}</dd>
                </>
              )}
            </DL>
          </div>
        );
      })}
    </div>
  );
}

function Runbar({
  pricedLines,
  extendedPrice,
  backHref,
  continueHref,
}: {
  pricedLines: number;
  extendedPrice: string;
  backHref: string;
  continueHref: string;
}) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: SPACE.lg,
        flexWrap: 'wrap',
        borderTop: `1px solid ${COLOR.border}`,
        paddingTop: '0.875rem',
        marginTop: SPACE.xl,
      }}
    >
      <span>
        So far: {pricedLines} priced {pricedLines === 1 ? 'line' : 'lines'}, <b>{extendedPrice}</b>.
        Nothing reaches the customer until you send it.
      </span>
      <div style={{ display: 'flex', gap: SPACE.md, flexWrap: 'wrap' }}>
        <LinkButton href={backHref}>Back to lines</LinkButton>
        <LinkButton href={continueHref}>Continue to review and send</LinkButton>
      </div>
    </div>
  );
}
