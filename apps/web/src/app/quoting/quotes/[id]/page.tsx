// The quote page. While a quote is a draft or awaits a decision it is step 2, Lines: docs/product/requirements.md (R3).
// After that it is the quote's record, opening with whose move it is: docs/product/requirements.md (R12).
// The lines form is apps/web/src/app/quoting/quotes/[id]/components/lines-editor.tsx.
import { notFound } from 'next/navigation';

import { formatMoney, quoteReference, quoteWithLinesSchema } from '@erp/types';
import {
  COLOR,
  DangerBanner,
  ErrorBanner,
  Fold,
  FoldGroup,
  FONT_SIZE,
  InfoBanner,
  LinkButton,
  PageLede,
  PageShell,
  RecordHead,
  Section,
  SectionNote,
  SPACE,
  StatusChip,
  StepStrip,
} from '@erp/ui';

import { loadRecipientsForRole } from '../../../../lib/document-recipient';
import { submitted } from '../../../../lib/form-echo';
import { onlyDesk } from '../../../../lib/helptext';
import { loadMe } from '../../../../lib/load-me';
import { lifecycle } from '../../../../lib/record/lifecycle';
import { UNKNOWN_CUSTOMER } from '../../customer-names';
import { creditExceptionState } from '../../credit-exception';
import { CreditExceptionSection, CreditHoldNotice } from '../../credit-hold-notice';
import { loadCreditApprovals } from '../../load-credit-approvals';
import { QUOTE_STATUS_LABELS } from '../../format';
import { LinesEditor } from './components/lines-editor';
import { ReadOnlyLine } from './components/read-only-line';
import { LeadTimeSection } from './components/lead-time-section';
import { StepsHeader } from './components/steps-header';
import { quoteSteps, stepHrefs } from './steps';
import { DocumentBlocked, SendCopyForm } from './components/quote-document-section';
import {
  OurFiguresFold,
  PriceApprovalsFold,
  SendsFold,
  VersionsFold,
} from './components/quote-folds';
import { QuoteRareActs } from './components/quote-rare-acts';
import {
  MissingDocumentBanner,
  OrdersFromThisQuote,
  QuoteActNow,
} from './components/record-act-now';
import { PO_MISSING_FIELD } from './convert/convert-po-document';
import { quoteDocumentState } from './printability';
import {
  customerSentAt,
  missingDocumentRows,
  productionToldAt,
  quoteChip,
  quoteOrderRows,
  quotePanel,
  quoteStrip,
  quoteWorkItem,
} from './record';
import { customerCopy, papersOf } from './review/customer-copy';
import { CustomerCopySection } from './review/customer-copy-section';
import {
  approvalLive as isApprovalLive,
  canWrite as roleCanWrite,
  editable as isEditable,
  floorRejectionSentence,
  freshRejection as findFreshRejection,
  latestVersion as findLatestVersion,
  leadTimeEditable as isLeadTimeEditable,
  leadTimePanel,
  manualPriceCount,
  showsLinesStep,
} from './derive';
import { newLineSeeds } from './line-defaults';
import {
  loadOrdersForQuote,
  loadCustomer,
  loadDecisions,
  loadGrades,
  loadOrderDetails,
  loadPricingConfig,
  loadQuote,
  loadSendability,
  loadSends,
  loadTiers,
  loadTotals,
  loadVersions,
} from './loaders';
import { loadResolvedRep } from '../../../../lib/sales-reps';
import { seedTaxTreatment } from './tax-seed';
import { loadCustomerDefaults } from '../../../../lib/customer-defaults';
import { encodeCustomerParts, lineSeedOf } from './customer-seed';
import { recordTitle } from '../../../../lib/record-title';

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    error?: string;
    notice?: string;
    resend?: string;

    poMissing?: string;

    [key: string]: string | string[] | undefined;
  }>;
}

export async function generateMetadata({ params }: PageProps) {
  const { id } = await params;
  const title = await recordTitle(
    `/quoting/quotes/${encodeURIComponent(id)}`,
    quoteWithLinesSchema,
    (quote) => `Quote ${quoteReference(quote)}`,
    'Quote',
  );
  return { title };
}

export default async function QuoteEntryPage({ params, searchParams }: PageProps) {
  const { id } = await params;

  const query = await searchParams;
  const { error, notice, resend } = query;
  const echo = submitted(query);

  const mePromise = loadMe();

  const wave1 = Promise.all([loadQuote(id), loadGrades(), loadTiers(), loadPricingConfig()]);
  // The reads start before the session check finishes. The empty catch only keeps a failure from
  // being reported as unhandled meanwhile. The await below still throws it.
  wave1.catch(() => {});
  const me = await mePromise;
  if (me === null) {
    return (
      <PageShell>
        <h1>Quote</h1>
        <p>
          <a href="/login" style={{ color: COLOR.accent }}>
            Sign in
          </a>{' '}
          to view this page.
        </p>
      </PageShell>
    );
  }

  const [quoteResult, grades, tiers, pricingConfig] = await wave1;
  if (quoteResult === null) {
    notFound();
  }
  const quote = quoteResult;

  const [customer, customerDefaults, sendability, sends, totals, versions, decisions, quoteOrders] =
    await Promise.all([
      loadCustomer(quote.customerId),

      loadCustomerDefaults(quote.customerId),
      loadSendability(id),
      loadSends(id),
      loadTotals(id),
      loadVersions(id),
      loadDecisions(id),
      loadOrdersForQuote(quote),
    ]);

  // After a refused save the form is drawn again with the version it was first drawn at, not the
  // current one, so a change made meanwhile is still caught: docs/decisions/006-optimistic-concurrency.md.
  const linesDrawnAt =
    typeof query['linesDrawnAt'] === 'string' &&
    Object.keys(echo).some((key) => key.startsWith('lines['))
      ? query['linesDrawnAt']
      : String(quote.lockVersion);

  const customerName = customer?.name ?? UNKNOWN_CUSTOMER;

  const [salesRep, leadTimeSetter] = await Promise.all([
    loadResolvedRep(quote.salesRep),
    loadResolvedRep(quote.leadTimeSetBy),
  ]);

  const quoteRecipients = await loadRecipientsForRole(quote.customerId, 'quote');

  const newLine = newLineSeeds(customer?.shippingAddress, seedTaxTreatment(customer), quote.lines);
  const lineSeed = lineSeedOf(customerDefaults, tiers);
  const customerPartsValue = encodeCustomerParts(customerDefaults.parts);

  const creditApprovals =
    customer !== null && customer.creditHold ? await loadCreditApprovals(customer.id) : [];
  const creditState = creditExceptionState(customer ?? { creditHold: false }, creditApprovals);

  const canWrite = roleCanWrite(me.roles);
  const editable = isEditable(me.roles, quote.status);

  const leadTimeEditable = isLeadTimeEditable(me.roles, quote.status);
  const gradeById = new Map(grades.map((g) => [g.id, g]));
  const latestVersion = findLatestVersion(versions);
  const manualCount = manualPriceCount(quote.lines);
  const approvalLive = isApprovalLive(quote);
  const freshRejection = findFreshRejection(quote.status, decisions);

  const documentState = quoteDocumentState({
    status: quote.status,
    sendability,
    manualCount,
    approvalLive,
    leadTimeDays: quote.leadTimeDays,
  });

  const banners = (
    <>
      <ErrorBanner message={error} />
      {notice !== undefined && <InfoBanner>{notice}</InfoBanner>}

      {grades.length === 0 && (
        <DangerBanner>
          No grades are configured —{' '}
          <a href="/quoting/grades" style={{ color: COLOR.accent }}>
            add one
          </a>{' '}
          before quoting.
        </DangerBanner>
      )}

      {freshRejection !== undefined &&
        (freshRejection.kind === 'floor' ? (
          <DangerBanner>{floorRejectionSentence(freshRejection)}</DangerBanner>
        ) : (
          <DangerBanner>
            Price approval rejected by {freshRejection.actor}
            {freshRejection.reason !== undefined && <>: "{freshRejection.reason}"</>} — rework the
            lines and request approval again.
          </DangerBanner>
        ))}

      {customer !== null && customer.creditHold && <CreditHoldNotice customer={customer} />}
      {customer !== null && (
        <CreditExceptionSection customer={customer} state={creditState} quoteId={id} />
      )}
    </>
  );

  const readOnlyNote = (
    <>
      {!canWrite && (
        <div style={{ marginTop: SPACE.lg }}>
          <SectionNote>{onlyDesk('Sales', 'prices and sends a quote')}</SectionNote>
        </div>
      )}
    </>
  );

  const linesSection = (
    <Section
      id="lines"
      title="Lines"
      note={editable && 'Saving prices every line again. Nothing is sent until you send it.'}
    >
      {editable ? (
        <LinesEditor
          quote={quote}
          query={query}
          echo={echo}
          linesDrawnAt={linesDrawnAt}
          grades={grades}
          tiers={tiers}
          marginFloorPct={pricingConfig.marginFloorPct}
          taxSeed={newLine.taxSeed}
          shippingSeed={newLine.shippingSeed}
          billingState={customer?.billingAddress?.state ?? ''}
          lineSeed={lineSeed}
          customerParts={customerDefaults.parts}
          customerPartsValue={customerPartsValue}
          approvalLive={approvalLive}
        />
      ) : quote.lines.length === 0 ? (
        <p style={{ color: COLOR.muted }}>No lines.</p>
      ) : (
        <div style={{ display: 'grid', gap: '0.75rem' }}>
          {quote.lines.map((line) => (
            <ReadOnlyLine key={line.id} line={line} grade={gradeById.get(line.gradeId)} />
          ))}
        </div>
      )}
    </Section>
  );

  // A draft, or a quote awaiting a decision, is still being entered, so the page is step 2.
  if (showsLinesStep(quote.status)) {
    const hrefs = stepHrefs(quote.id);
    const panel = leadTimePanel(me.roles, quote.status, quote.leadTimeDays);
    return (
      <PageShell>
        <p style={{ margin: `0 0 ${SPACE.md}`, fontSize: FONT_SIZE.sm, color: COLOR.muted }}>
          <a href="/quoting/quotes" style={{ color: COLOR.accent }}>
            Quotes
          </a>{' '}
          / {quoteReference(quote)}
        </p>
        <h1>
          Quote {quoteReference(quote)} for {customerName}
          <StatusChip>{QUOTE_STATUS_LABELS[quote.status]}</StatusChip>
        </h1>

        {quote.notes !== undefined && <PageLede>{quote.notes}</PageLede>}

        {banners}
        <StepStrip steps={quoteStrip({ quote, roles: me.roles, now: new Date() })} />
        <StepsHeader
          steps={quoteSteps({
            quoteId: quote.id,
            customerName,
            lines: quote.lines,

            openRows: editable ? 1 : 0,
            leadTimeDays: quote.leadTimeDays,
          })}
        />
        {readOnlyNote}
        {linesSection}

        {panel !== 'none' && (
          <LeadTimeSection
            quote={quote}
            state={panel}
            formLive={leadTimeEditable}
            customerLeadTimeDays={customerDefaults.leadTimeDays}
            enteredByName={leadTimeSetter?.displayName}
            sends={sends}
            now={new Date()}
          />
        )}

        <Runbar
          pricedLines={quote.lines.length}
          extendedPrice={formatMoney(totals.extendedPrice)}
          backHref={hrefs.customer}
          continueHref={hrefs.delivery}
        />
        <div style={{ margin: `${SPACE.xl} 0` }}>
          <LinePricingFold />
        </div>

        <QuoteRareActs
          closeHref={canWrite ? hrefs.close : undefined}
          buildUpHref={quote.lines.length > 0 ? hrefs.buildUp : undefined}
        />
      </PageShell>
    );
  }

  const now = new Date();
  const sentAt = customerSentAt(sends);

  const orderDetails = await loadOrderDetails(quoteOrders);
  const life = lifecycle({
    kind: 'quote',
    record: quoteWorkItem(quote),
    orders: quoteOrders,
    sentAt,
    productionToldAt: productionToldAt(sends),
    roles: me.roles,
    now,
  });
  const panel = quotePanel({
    status: quote.status,

    orders: quoteOrders,
    canWrite,
    act: life.act,
  });
  const currentVersion =
    latestVersion !== undefined && latestVersion.id !== quote.id ? latestVersion : undefined;

  const copy = customerCopy({
    quote,
    totals,
    customerName,
    salesRepName: salesRep?.displayName,
    papers: papersOf(grades),
  });

  const maySend = canWrite && quote.status === 'quoted' && documentState.kind === 'ready';
  const quoted = canWrite && quote.status === 'quoted';

  const missingDocument = missingDocumentRows(
    query[PO_MISSING_FIELD],
    quoteOrders,
    quoteReference(quote),
  );

  return (
    <PageShell>
      <RecordHead
        crumb={[{ label: 'Quotes', href: '/quoting/quotes' }, { label: quoteReference(quote) }]}
        title={`Quote ${quoteReference(quote)} for ${customerName}`}
        chip={quoteChip(quote.status, quoteOrders.length)}
        lede={quote.notes}
      />

      {missingDocument.length > 0 ? (
        <MissingDocumentBanner message={error} rows={missingDocument} />
      ) : (
        <ErrorBanner message={error} />
      )}
      {notice !== undefined && <InfoBanner>{notice}</InfoBanner>}

      {customer !== null && customer.creditHold && <CreditHoldNotice customer={customer} />}
      {customer !== null && (
        <CreditExceptionSection customer={customer} state={creditState} quoteId={id} />
      )}

      <StepStrip steps={life.steps} />

      <QuoteActNow panel={panel} quote={quote} currentVersion={currentVersion} />
      {quoteOrders.length > 0 && (
        <OrdersFromThisQuote
          rows={quoteOrderRows({
            orders: quoteOrders,
            quoteRef: quoteReference(quote),
            lines: orderDetails.lines,
          })}
        />
      )}

      <CustomerCopySection
        quote={quote}
        copy={copy}
        title={sentAt === null ? 'The quote' : 'The quote as it went'}
        printable={documentState.kind === 'ready'}
      />

      {quote.status !== 'closed_lost' && <DocumentBlocked state={documentState} />}

      <FoldGroup>
        <OurFiguresFold quote={quote} totals={totals} />

        <SendsFold sends={sends} open={resend === '1'}>
          {maySend && (
            <SendCopyForm
              quote={quote}
              recipients={quoteRecipients}
              again={sentAt !== null || resend === '1'}
            />
          )}
        </SendsFold>
        <PriceApprovalsFold decisions={decisions} />
        <VersionsFold quote={quote} versions={versions} />
      </FoldGroup>

      <QuoteRareActs
        revise={quoted ? { quoteId: quote.id, nextVersion: quote.versionNumber + 1 } : undefined}
        closeHref={quoted && quoteOrders.length === 0 ? stepHrefs(quote.id).close : undefined}
        buildUpHref={
          quote.status === 'quoted' && quote.lines.length > 0
            ? stepHrefs(quote.id).buildUp
            : undefined
        }
      />
    </PageShell>
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
        <LinkButton href={backHref}>Back to customer</LinkButton>
        <LinkButton href={continueHref}>Continue to delivery and tax</LinkButton>
      </div>
    </div>
  );
}

function LinePricingFold() {
  return (
    <Fold summary="How a line is priced" sum="paper cost, tier margin, freight">
      <p style={{ margin: 0, fontSize: FONT_SIZE.sm }}>
        The paper picks the grade and the footage a roll is cut to. Quantity is rolls, and the
        pallet count sets the tier unless you pick one. A hand-set price replaces the tier price and
        needs the Billing Manager&apos;s approval before the quote can be sent. A price below the
        margin floor goes out only if an Admin overrides the floor. Freight follows the shipping
        mode. A pickup at the plant costs nothing, and a pickup at the warehouse is a flat rate. A
        carrier&apos;s bid may arrive after the goods are weighed. A per pound line is priced on the
        pounds ordered and billed on the weighed load less its pallet.
      </p>
    </Fold>
  );
}
