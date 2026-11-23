// The order section: the customer, the quote it came from, other orders from that quote, the PO,
// the sales rep, the production contacts and the order confirmation email.
import {
  formatMoney,
  freightKnowledge,
  gradeLabel,
  shortId,
  type Contact,
  type Grade,
  type Order,
  type OrderWithLines,
  type ResolvedSalesRep,
  type StoredDocumentSummary,
} from '@erp/types';
import { COLOR, KV, LineSummary, ResetList, SPACE, Section } from '@erp/ui';

import { API_BASE_URL } from '../../../../lib/api-fetch';
import { formatFeet, formatWidth } from '../../../../lib/measures';
import { formatPricePerPound } from '../../../../lib/price-per-pound';
import { ProductionContactRow } from '../../../../lib/production-contact-section';
import { queueName } from '../../../../lib/record-title';
import { SalesRepName } from '../../../../lib/sales-rep-name';
import { orderFoldPage, orderPage } from '../../../../lib/work/work';
import { dueDay } from '../due-day';
import { freightCaveat } from '../../../quoting/format';
import { deliveryWords } from '../../../quoting/quotes/[id]/line-defaults';
import { confirmationIssuable } from '../derive';
import { lineNote, otherOrderWords } from '../record-view';
import { SendConfirmation, type SentConfirmation } from './lifecycle-actions';

export function TheOrder({
  order,
  customer,
  quote,
  otherOrders,
  salesRep,
  documents,
  productionContacts,
  mayTag,
  confirmation,
  gradeById,
}: {
  order: OrderWithLines;

  customer: { name: string; city?: string | undefined; state?: string | undefined };
  quote: { reference: string | null; leadTimeDays: number | undefined };

  otherOrders: readonly Order[];
  salesRep: ResolvedSalesRep | undefined;
  documents: readonly StoredDocumentSummary[];

  productionContacts: readonly Contact[];
  mayTag: boolean;
  confirmation: {
    recipients: readonly string[];
    sent: SentConfirmation | null;
    maySend: boolean;
  };
  gradeById: ReadonlyMap<string, Grade>;
}) {
  const orderHref = `/orders/${encodeURIComponent(order.id)}`;

  const poFile = documents
    .filter((document) => document.kind === 'purchase_order')
    .reduce<StoredDocumentSummary | undefined>(
      (latest, document) =>
        latest === undefined || document.documentAt > latest.documentAt ? document : latest,
      undefined,
    );
  const due = dueDay(order);

  return (
    <Section title="The order">
      <KV>
        <dt>Customer</dt>
        <dd>
          <a
            href={`/crm/customers/${encodeURIComponent(order.customerId)}`}
            style={{ color: COLOR.accent }}
          >
            {customer.name}
          </a>
          {customer.city !== undefined && customer.state !== undefined && (
            <>
              , {customer.city}, {customer.state}
            </>
          )}
        </dd>

        <dt>Quote</dt>
        <dd>
          <a
            href={`/quoting/quotes/${encodeURIComponent(order.quoteId)}`}
            style={{ color: COLOR.accent }}
          >
            {quote.reference ?? shortId(order.quoteId)}
          </a>
          {quote.leadTimeDays !== undefined && (
            <>
              , lead time quoted {quote.leadTimeDays} day{quote.leadTimeDays === 1 ? '' : 's'}
            </>
          )}
        </dd>

        {otherOrders.length > 0 && (
          <>
            <dt>Other orders from this quote</dt>
            <dd>
              <ResetList gap={SPACE.xs}>
                {otherOrders.map((other) => (
                  <li key={other.id}>
                    <a href={orderPage(other.id)} style={{ color: COLOR.accent }}>
                      {queueName(other, quote.reference)}
                    </a>
                    : {otherOrderWords(other)}
                  </li>
                ))}
              </ResetList>
            </dd>
          </>
        )}

        {salesRep !== undefined && (
          <>
            <dt>Sales rep</dt>
            <dd>
              <SalesRepName rep={salesRep} />
            </dd>
          </>
        )}

        <dt>Customer PO</dt>
        <dd>
          <span>
            {order.poNumber === undefined && poFile === undefined ? (
              <span style={{ color: COLOR.muted }}>None recorded</span>
            ) : (
              <>
                {order.poNumber}
                {order.poNumber !== undefined && poFile !== undefined && ' · '}
                {poFile !== undefined && (
                  <a
                    href={`${API_BASE_URL}${orderHref}/documents/${encodeURIComponent(poFile.id)}`}
                    style={{ color: COLOR.accent }}
                  >
                    {poFile.filename}
                  </a>
                )}
              </>
            )}
          </span>

          {' · '}
          <a href={orderFoldPage(order.id, 'documents')} style={{ color: COLOR.accent }}>
            {poFile === undefined ? 'Attach the PO document' : 'Attach a corrected PO document'}
          </a>
        </dd>

        <ProductionContactRow
          customerId={order.customerId}
          contacts={productionContacts}
          mayTag={mayTag}
        />

        <dt>Delivery date</dt>
        <dd>{order.requestedDate ?? <span style={{ color: COLOR.muted }}>None given</span>}</dd>

        <dt>Job number</dt>
        <dd>
          {order.jobNumber ?? <span style={{ color: COLOR.muted }}>Given on confirmation</span>}
        </dd>

        {order.confirmedLeadTimeDays !== undefined && (
          <>
            <dt>Committed lead time</dt>
            <dd>
              {order.confirmedLeadTimeDays} day{order.confirmedLeadTimeDays === 1 ? '' : 's'}
              {due !== undefined && <>, due {due}</>}
            </dd>
          </>
        )}

        {confirmationIssuable(order.status) && (
          <>
            <dt>Order confirmation</dt>
            <dd>
              <SendConfirmation
                order={order}
                recipients={confirmation.recipients}
                sent={confirmation.sent}
                maySend={confirmation.maySend}
              />
            </dd>
          </>
        )}
      </KV>

      <div style={{ display: 'grid', gap: SPACE.md, marginTop: SPACE.lg }}>
        {order.lines.map((line) => {
          const grade = gradeById.get(line.gradeId);
          const paper = grade === undefined ? line.gradeId : gradeLabel(grade);

          const feet =
            line.feetPerRoll === undefined ? '' : ` × ${formatFeet(line.feetPerRoll)} ft`;
          const rolls = `${line.quantityRolls} roll${line.quantityRolls === 1 ? '' : 's'}`;
          const caveat = freightCaveat(freightKnowledge(line.freightResult));
          return (
            <LineSummary
              key={line.id}
              id={`line-${line.lineNumber}`}
              spec={`Line ${line.lineNumber} · ${paper} · ${formatWidth(line)}${feet} · ${rolls}`}
              delivery={deliveryWords(line.freight.mode, line.deliveryAddress)}
              price={
                line.pricingBasis === 'per_pound' && line.productPricePerLb !== undefined ? (
                  <>
                    <b>{formatPricePerPound(line.productPricePerLb)}</b> / lb ·{' '}
                    {formatMoney(line.extendedPrice)}, an estimate
                    {caveat}
                  </>
                ) : (
                  <>
                    <b>{formatMoney(line.pricePerRoll)}</b> / roll ·{' '}
                    {formatMoney(line.extendedPrice)}
                    {caveat}
                  </>
                )
              }
              note={lineNote(line)}
            />
          );
        })}
      </div>
    </Section>
  );
}
