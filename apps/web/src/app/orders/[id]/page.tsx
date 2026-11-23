// The order page: the step strip, then the Act now panel naming the next act or the desk it waits on,
// then the order and its folded detail: docs/product/requirements.md (R12) and docs/product/ux-direction.md.
// The order holds its own copy of the quote's lines and prices: docs/product/requirements.md (R9).
// The page reads the quote only for its reference and quoted lead time. Confirming starts in
// apps/web/src/app/orders/[id]/components/order-act-now.tsx.
import { notFound } from 'next/navigation';

import {
  COLOR,
  Fold,
  FoldGroup,
  InfoBanner,
  PageShell,
  RecordHead,
  StepStrip,
  ErrorBanner,
} from '@erp/ui';

import { loadResolvedRep } from '../../../lib/sales-reps';
import { loadRecipientsForRole } from '../../../lib/document-recipient';
import { loadProductionContacts } from '../../../lib/production-contact';
import { maySalesWrite } from '../../../lib/roles';
import { loadMe } from '../../../lib/load-me';
import { lifecycle } from '../../../lib/record/lifecycle';
import { shortId, orderWithLinesSchema, quoteWithLinesSchema, quoteReference } from '@erp/types';

import { UNKNOWN_CUSTOMER } from '../../quoting/customer-names';
import { ORDER_STATUS_LABELS, orderName } from '../format';
import { DocumentsSection } from './components/documents-section';
import { HistorySection } from './components/history-section';
import { OrderActNow } from './components/order-act-now';
import { OrderLineBox } from './components/order-line-box';
import { AttachDocumentForm } from './components/purchase-order';
import { TheOrder } from './components/the-order';
import {
  chipTone,
  confirmDefault,
  documentsSum,
  historySum,
  ocLine,
  orderHeading,
  orderLede,
  otherOrders,
  totalsSum,
  waitingWords,
} from './record-view';
import { RarelyNeeded } from './components/rarely-needed';
import { TotalsSection } from './components/totals-section';
import {
  confirmationIssuable as isConfirmationIssuable,
  mayConfirm as roleMayConfirm,
  maySendConfirmation as roleMaySendConfirmation,
} from './derive';
import {
  loadCustomer,
  loadDocuments,
  loadGrades,
  loadOrderSends,
  loadOrdersOfQuote,
  loadQuoteFacts,
  loadOrder,
  loadTotals,
  loadTransitions,
} from './loaders';
import { MISSING_RECORD_TITLE, recordRead } from '../../../lib/record-title';

interface PageProps {
  params: Promise<{ id: string }>;

  searchParams: Promise<{
    error?: string;
    field?: string;
    notice?: string;
    [key: string]: string | string[] | undefined;
  }>;
}

export async function generateMetadata({ params }: PageProps) {
  const { id } = await params;
  const read = await recordRead(`/orders/${encodeURIComponent(id)}`, orderWithLinesSchema);
  if (read.kind === 'missing') return { title: MISSING_RECORD_TITLE };
  if (read.kind === 'unread') return { title: 'Order' };
  const order = read.record;
  const quote = await recordRead(
    `/quoting/quotes/${encodeURIComponent(order.quoteId)}`,
    quoteWithLinesSchema,
  );
  return { title: orderName(order, quote.kind === 'found' ? quoteReference(quote.record) : null) };
}

export default async function OrderDetailPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const query = await searchParams;
  const { error, field, notice } = query;

  const mePromise = loadMe();
  const wave1 = Promise.all([loadOrder(id), loadGrades()]);
  // The order reads start before the session read finishes. This handler keeps an early failure from
  // being reported as unhandled. Awaiting `wave1` below still throws it.
  wave1.catch(() => {});
  const me = await mePromise;
  if (me === null) {
    return (
      <PageShell>
        <h1>Order</h1>
        <p>
          <a href="/login" style={{ color: COLOR.accent }}>
            Sign in
          </a>{' '}
          to view this page.
        </p>
      </PageShell>
    );
  }

  const [orderResult, grades] = await wave1;
  if (orderResult === null) {
    notFound();
  }
  const order = orderResult;

  const [confirmationRecipients, productionContacts] = await Promise.all([
    loadRecipientsForRole(order.customerId, 'order_confirmation'),
    loadProductionContacts(order.customerId),
  ]);

  const [customer, totals, transitions, documents, quoteFacts, sends, ordersOfQuote] =
    await Promise.all([
      loadCustomer(order.customerId),
      loadTotals(id),
      loadTransitions(id),
      loadDocuments(id),
      loadQuoteFacts(order.quoteId),
      isConfirmationIssuable(order.status) ? loadOrderSends(id) : Promise.resolve([]),
      loadOrdersOfQuote(order.quoteId),
    ]);
  const customerName = customer?.name ?? UNKNOWN_CUSTOMER;
  const quoteLabel = quoteFacts?.reference ?? null;

  const salesRep = await loadResolvedRep(order.salesRep);

  const gradeById = new Map(grades.map((g) => [g.id, g]));

  const { crumbLabel, title } = orderHeading({ order, quoteRef: quoteLabel, customerName });

  const mayConfirm = roleMayConfirm(me.roles);
  const maySend = roleMaySendConfirmation(me.roles);

  const fieldError =
    error !== undefined && field !== undefined ? { field, message: error } : undefined;

  const now = new Date();
  const poFiled = documents.some((document) => document.kind === 'purchase_order');
  const life = lifecycle({
    kind: 'order',
    record: order,
    transitions,

    quote: { id: order.quoteId, number: quoteLabel ?? shortId(order.quoteId), sentAt: null },
    roles: me.roles,
    now,
    poFiled,
  });
  const lineCount = order.lines.length;

  return (
    <PageShell>
      <RecordHead
        crumb={[{ label: 'Orders', href: '/orders' }, { label: crumbLabel }]}
        title={title}
        chip={{
          label: ORDER_STATUS_LABELS[order.status],
          tone: chipTone(life.act),
        }}
        lede={orderLede({ order, lines: order.lines, gradeById, mayConfirm, now })}
      />

      <ErrorBanner message={error} />

      <InfoBanner>{notice}</InfoBanner>

      <StepStrip steps={life.steps} />

      <OrderActNow
        order={order}
        act={life.act}
        confirm={confirmDefault(quoteFacts?.leadTimeDays, now)}
        waiting={waitingWords(order.status)}
        fieldError={fieldError?.field === 'confirmedLeadTimeDays' ? fieldError.message : undefined}
      />

      <TheOrder
        order={order}
        customer={{
          name: customerName,
          city: customer?.billingAddress?.city,
          state: customer?.billingAddress?.state,
        }}
        quote={{ reference: quoteLabel, leadTimeDays: quoteFacts?.leadTimeDays }}
        otherOrders={otherOrders(ordersOfQuote, order.id)}
        salesRep={salesRep}
        documents={documents}
        productionContacts={productionContacts}
        mayTag={maySalesWrite(me.roles)}
        confirmation={{
          recipients: confirmationRecipients,
          sent: ocLine(sends),
          maySend,
        }}
        gradeById={gradeById}
      />

      <FoldGroup>
        <Fold
          summary="Line details"
          sum={`${lineCount} line${lineCount === 1 ? '' : 's'}: price, freight, margin and paper`}
        >
          {order.lines.map((line) => (
            <OrderLineBox key={line.id} line={line} grade={gradeById.get(line.gradeId)} />
          ))}
        </Fold>
        <Fold summary="Totals" sum={totalsSum(totals)}>
          <TotalsSection totals={totals} lines={order.lines} />
        </Fold>

        <div id="documents">
          <Fold
            summary={`Documents (${documents.length})`}
            sum={documentsSum(documents)}
            open={field === 'documents'}
          >
            <DocumentsSection orderId={order.id} documents={documents} />
            <AttachDocumentForm
              order={order}
              error={fieldError?.field === 'documents' ? fieldError.message : undefined}
            />
          </Fold>
        </div>

        <Fold summary="History" sum={historySum(transitions)}>
          <HistorySection transitions={transitions} />
        </Fold>
      </FoldGroup>

      <RarelyNeeded order={order} />
    </PageShell>
  );
}
