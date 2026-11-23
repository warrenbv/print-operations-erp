// The confirm page for closing a quote as lost. It offers the act only to Sales, and only while the
// quote may move to closed (lost) and has no order. The API refuses a close once an order exists.
import { notFound } from 'next/navigation';

import {
  formatMoney,
  QUOTE_TRANSITIONS,
  quoteReference,
  quoteWithLinesSchema,
  type QuoteStatus,
} from '@erp/types';
import {
  Box,
  Button,
  COLOR,
  ErrorBanner,
  FONT_SIZE,
  LinkButton,
  PageShell,
  SectionNote,
  SPACE,
} from '@erp/ui';

import { onlyDesk } from '../../../../../lib/helptext';
import { loadMe } from '../../../../../lib/load-me';
import { recordTitle } from '../../../../../lib/record-title';
import { maySalesWrite } from '../../../../../lib/roles';
import { UNKNOWN_CUSTOMER } from '../../../customer-names';
import { QUOTE_STATUS_LABELS } from '../../../format';
import { orderName } from '../../../../orders/format';
import { loadCustomer, loadOrdersForQuote, loadQuote, loadTotals } from '../loaders';
import { closeAsLostAction } from './actions';

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}

export async function generateMetadata({ params }: PageProps) {
  const { id } = await params;
  const title = await recordTitle(
    `/quoting/quotes/${encodeURIComponent(id)}`,
    quoteWithLinesSchema,
    (quote) => `Close ${quoteReference(quote)} as lost`,
    'Close as lost',
  );
  return { title };
}

export default async function CloseQuotePage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const { error } = await searchParams;

  const me = await loadMe();
  if (me === null) {
    return (
      <PageShell>
        <h1>Close as lost</h1>
        <p>
          <a href="/login" style={{ color: COLOR.accent }}>
            Sign in
          </a>{' '}
          to view this page.
        </p>
      </PageShell>
    );
  }

  const quote = await loadQuote(id);
  if (quote === null) {
    notFound();
  }
  const [customer, totals, orders] = await Promise.all([
    loadCustomer(quote.customerId),
    loadTotals(quote.id),
    loadOrdersForQuote(quote),
  ]);

  const reference = quoteReference(quote);
  const quoteHref = `/quoting/quotes/${encodeURIComponent(quote.id)}`;
  const lineCount = quote.lines.length;

  const canWrite = maySalesWrite(me.roles);
  const firstOrder = orders[0];

  const openable = firstOrder === undefined && closable(quote.status);
  const offered = openable && canWrite;

  return (
    <PageShell>
      <p style={{ margin: `0 0 ${SPACE.md}`, fontSize: FONT_SIZE.sm, color: COLOR.muted }}>
        <a href="/quoting/quotes" style={{ color: COLOR.accent }}>
          Quotes
        </a>{' '}
        /{' '}
        <a href={quoteHref} style={{ color: COLOR.accent }}>
          {reference}
        </a>
      </p>

      <ErrorBanner message={error} />

      <Box style={{ maxWidth: '560px', gap: SPACE.xl, padding: SPACE.xxl }}>
        <h1 style={{ margin: 0 }}>Close {reference} as lost?</h1>
        <p style={{ margin: 0 }}>
          {customer?.name ?? UNKNOWN_CUSTOMER} · {lineCount} line{lineCount === 1 ? '' : 's'} ·{' '}
          {formatMoney(totals.extendedPrice)}. The quote stays on the record and cannot be reopened;
          a later quote for this customer is a new quote. The customer is not emailed.
        </p>

        {firstOrder !== undefined ? (
          <SectionNote>
            {reference} became an order (
            <a href={`/orders/${firstOrder.id}`} style={{ color: COLOR.accent }}>
              {orderName(firstOrder, reference)}
            </a>
            ), so it cannot be closed as lost. To stop the work, cancel the order.
          </SectionNote>
        ) : !closable(quote.status) ? (
          <SectionNote>
            {reference} is {QUOTE_STATUS_LABELS[quote.status]}, so it cannot be closed as lost.
          </SectionNote>
        ) : !canWrite ? (
          <SectionNote>{onlyDesk('Sales', 'closes a quote as lost')}</SectionNote>
        ) : null}

        <div style={{ display: 'flex', gap: SPACE.lg, alignItems: 'center', flexWrap: 'wrap' }}>
          {offered && (
            <form action={closeAsLostAction}>
              <input type="hidden" name="quoteId" value={quote.id} />

              <input type="hidden" name="lockVersion" value={quote.lockVersion} />

              <Button variant="danger">Close as lost</Button>
            </form>
          )}

          <LinkButton href={quoteHref}>
            {openable ? 'Keep it open' : 'Back to the quote'}
          </LinkButton>
        </div>
      </Box>
    </PageShell>
  );
}

// The quote's own transition table decides, the same one the API applies: packages/types/src/quote.ts.
function closable(status: QuoteStatus): boolean {
  return QUOTE_TRANSITIONS[status].includes('closed_lost');
}
