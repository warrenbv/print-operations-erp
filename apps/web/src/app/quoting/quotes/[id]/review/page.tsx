// Step 4, Review and send: every send condition with the desk that clears it: docs/product/requirements.md (R8).
// A quote past draft has no step 4, so the page sends the reader to the quote's record.
// The checklist is built by apps/web/src/app/quoting/quotes/[id]/review/gates.ts.
import { notFound, redirect } from 'next/navigation';

import { contactListResponseSchema, quoteReference, quoteWithLinesSchema } from '@erp/types';
import {
  COLOR,
  DangerBanner,
  ErrorBanner,
  FoldGroup,
  FONT_SIZE,
  InfoBanner,
  PageLede,
  PageShell,
  SPACE,
  StatusChip,
  StepStrip,
} from '@erp/ui';

import { fetchParsed } from '../../../../../lib/fetch-parsed';
import { loadMailRedirect } from '../../../../../lib/load-mail-mode';
import { loadMe } from '../../../../../lib/load-me';
import { recordTitle } from '../../../../../lib/record-title';
import { mayOverrideFloor } from '../../../../../lib/roles';
import { loadResolvedRep } from '../../../../../lib/sales-reps';
import { mailModeSentence } from '../../../../nav/mail-mode';
import { UNKNOWN_CUSTOMER } from '../../../customer-names';
import { creditExceptionState } from '../../../credit-exception';
import { CreditExceptionSection, CreditHoldNotice } from '../../../credit-hold-notice';
import { loadCreditApprovals } from '../../../load-credit-approvals';
import { sendAction } from '../action-rail';
import { OurFiguresFold, PriceApprovalsFold, SendsFold } from '../components/quote-folds';
import { QuoteRareActs } from '../components/quote-rare-acts';
import { StepsHeader } from '../components/steps-header';
import {
  agreedLineNumbers,
  approvalLive as isApprovalLive,
  canWrite as roleCanWrite,
  floorRejectionSentence,
  freshRejection as findFreshRejection,
  lastDecisionOf,
  leadTimeWaitingLine,
  manualPriceCount,
  showsLinesStep,
} from '../derive';
import {
  loadCustomer,
  loadDecisions,
  loadGrades,
  loadQuote,
  loadSendability,
  loadSends,
  loadTotals,
} from '../loaders';
import { quoteDocumentState } from '../printability';
import { quoteStrip } from '../record';
import { quoteSteps, stepHrefs } from '../steps';
import { ActNowPanel } from './act-now-panel';
import { customerCopy, papersOf } from './customer-copy';
import { CustomerCopySection } from './customer-copy-section';
import { quoteGates, quoteRecipientsOf } from './gates';

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; notice?: string; resend?: string }>;
}

export async function generateMetadata({ params }: PageProps) {
  const { id } = await params;
  const title = await recordTitle(
    `/quoting/quotes/${encodeURIComponent(id)}`,
    quoteWithLinesSchema,
    (quote) => `Review and send quote ${quoteReference(quote)}`,
    'Review and send',
  );
  return { title };
}

export default async function QuoteReviewPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const query = await searchParams;
  const { error, notice } = query;

  const mePromise = loadMe();
  const wave1 = Promise.all([loadQuote(id), loadMailRedirect()]);
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

  const [quoteResult, mailRedirect] = await wave1;
  if (quoteResult === null) {
    notFound();
  }
  const quote = quoteResult;
  const quotePath = `/quoting/quotes/${encodeURIComponent(quote.id)}`;

  if (!showsLinesStep(quote.status)) {
    const carried = new URLSearchParams(
      Object.entries(query).filter(
        (entry): entry is [string, string] =>
          ['error', 'notice', 'resend'].includes(entry[0]) && typeof entry[1] === 'string',
      ),
    ).toString();
    redirect(carried === '' ? quotePath : `${quotePath}?${carried}`);
  }

  const [customer, contacts, sendability, sends, totals, decisions, grades] = await Promise.all([
    loadCustomer(quote.customerId),
    fetchParsed(
      `/crm/customers/${encodeURIComponent(quote.customerId)}/contacts`,
      contactListResponseSchema,
    ),
    loadSendability(id),
    loadSends(id),
    loadTotals(id),
    loadDecisions(id),
    loadGrades(),
  ]);
  const [salesRep, leadTimeSetter, floorOverrider, creditApprovals] = await Promise.all([
    loadResolvedRep(quote.salesRep),
    loadResolvedRep(quote.leadTimeSetBy),

    loadResolvedRep(quote.floorOverrideBy),

    customer !== null && customer.creditHold ? loadCreditApprovals(customer.id) : [],
  ]);

  const customerName = customer?.name ?? UNKNOWN_CUSTOMER;
  const creditState = creditExceptionState(customer ?? { creditHold: false }, creditApprovals);
  const canWrite = roleCanWrite(me.roles);
  const manualCount = manualPriceCount(quote.lines);
  const approvalLive = isApprovalLive(quote);

  const send = sendAction({
    status: quote.status,
    sendability,
    manualCount,
    approvalLive,
    floorOverrider: mayOverrideFloor(me.roles),
  });
  const documentState = quoteDocumentState({
    status: quote.status,
    sendability,
    manualCount,
    approvalLive,
    leadTimeDays: quote.leadTimeDays,
  });
  const recipients = quoteRecipientsOf(contacts.items);
  const now = new Date();

  const floorApproval = lastDecisionOf(decisions, 'approved', 'floor');
  const gates = quoteGates({
    status: quote.status,
    lineCount: quote.lines.length,
    send,
    manualCount,

    agreedLines: agreedLineNumbers(quote.lines),
    approvalLive,
    leadTime: {
      days: quote.leadTimeDays,
      enteredBy: leadTimeSetter?.displayName ?? quote.leadTimeSetBy,
      enteredAt: quote.leadTimeSetAt,
    },

    leadTimeWaitingLine:
      quote.leadTimeDays === undefined ? leadTimeWaitingLine(quote, sends, now) : undefined,
    approvalRequestedAt: lastDecisionOf(decisions, 'requested', 'price')?.at,
    floorRequestedAt: lastDecisionOf(decisions, 'requested', 'floor')?.at,
    floorOverride:
      quote.floorOverrideBy === undefined || quote.floorOverrideAt === undefined
        ? undefined
        : {
            by: floorOverrider?.displayName ?? quote.floorOverrideBy,
            at: quote.floorOverrideAt,
            reason: floorApproval?.reason,
          },
    recipients,
    customerName,
    credit: creditState,
    canWrite,
    revision: quote.versionNumber > 1,
    now,
  });
  const freshRejection = findFreshRejection(quote.status, decisions);
  const hrefs = stepHrefs(quote.id);
  const copy = customerCopy({
    quote,
    totals,
    customerName,
    salesRepName: salesRep?.displayName,
    papers: papersOf(grades),
  });

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
        <StatusChip tone={gates.chip.tone}>{gates.chip.label}</StatusChip>
      </h1>
      {quote.notes !== undefined && <PageLede>{quote.notes}</PageLede>}

      <ErrorBanner message={error} />
      {notice !== undefined && <InfoBanner>{notice}</InfoBanner>}
      {freshRejection !== undefined &&
        (freshRejection.kind === 'floor' ? (
          <DangerBanner>{floorRejectionSentence(freshRejection)}</DangerBanner>
        ) : (
          <DangerBanner>
            Price approval rejected by {freshRejection.actor}
            {freshRejection.reason !== undefined && <>: &ldquo;{freshRejection.reason}&rdquo;</>} —
            rework the lines and request approval again.
          </DangerBanner>
        ))}
      {customer !== null && customer.creditHold && <CreditHoldNotice customer={customer} />}
      {customer !== null && (
        <CreditExceptionSection customer={customer} state={creditState} quoteId={id} />
      )}

      <StepStrip steps={quoteStrip({ quote, roles: me.roles, now })} />
      <StepsHeader
        steps={quoteSteps({
          quoteId: quote.id,
          customerName,
          lines: quote.lines,
          openRows: 0,
          leadTimeDays: quote.leadTimeDays,
          current: 4,
        })}
      />

      <ActNowPanel quote={quote} gates={gates} mailModeNote={mailModeSentence(mailRedirect)} />

      <CustomerCopySection
        quote={quote}
        copy={copy}
        title={`What ${recipients.names[0] ?? customerName} will receive`}
        printable={documentState.kind === 'ready'}
        change={{ linesHref: hrefs.lines, deliveryHref: hrefs.delivery }}
      />

      <FoldGroup>
        <OurFiguresFold quote={quote} totals={totals} />
        <SendsFold sends={sends} />
        <PriceApprovalsFold decisions={decisions} />
      </FoldGroup>

      <QuoteRareActs
        closeHref={canWrite ? hrefs.close : undefined}
        buildUpHref={quote.lines.length > 0 ? hrefs.buildUp : undefined}
      />
    </PageShell>
  );
}
