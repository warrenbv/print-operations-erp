// The Quotes list, grouped by whose move it is: docs/product/requirements.md (R12).
// Search takes a quote number or part of a customer's name. The grouping is in apps/web/src/app/quoting/quotes/queue.ts.
import {
  CUSTOMER_SEARCH_MAX_LIMIT,
  customerSearchResponseSchema,
  parseQuoteNumber,
  quoteListResponseSchema,
  quoteReference,
  type QuoteListItem,
} from '@erp/types';
import {
  Button,
  COLOR,
  DataLine,
  EmptyState,
  Field,
  FieldLabel,
  Fold,
  FONT_SIZE,
  Input,
  LinkButton,
  PageLede,
  PageShell,
  QueueCell,
  QueueGroupRow,
  QueueTable,
  RADIUS,
  RowLink,
  AgeCell,
  SectionNote,
  Select,
  SPACE,
  StatusChip,
} from '@erp/ui';

import { formatAge, formatDay, isLate } from '../../../lib/dates';
import { fetchParsed } from '../../../lib/fetch-parsed';
import { ONLY_SALES_STARTS_A_QUOTE } from '../../../lib/helptext';
import { loadMe } from '../../../lib/load-me';
import { queueName } from '../../../lib/record-title';
import { defaultRep, parseRepFilter } from '../../../lib/rep-filter';
import { maySalesWrite } from '../../../lib/roles';
import { SalesRepName } from '../../../lib/sales-rep-name';
import { loadResolvedReps, loadSalesReps } from '../../../lib/sales-reps';
import { loadWorkbook, ordersByQuote } from '../../../lib/work/load-workbook';
import { quoteWork } from '../../../lib/work/quote-work';
import { orderPage, quotePage } from '../../../lib/work/work';
import { ORDER_STATUS_LABELS } from '../../orders/format';
import { UNKNOWN_CUSTOMER } from '../customer-names';
import { QUOTE_STATUS_LABELS } from '../format';
import {
  closedSum,
  GROUP_TONES,
  noRepFootnote,
  parseShow,
  queueChipLabel,
  quoteQueue,
  SHOW_OPTIONS,
  successorOf,
  whatHappened,
  type QueueQuote,
  type QuoteShow,
} from './queue';

export const metadata = { title: 'Quotes' };

interface PageProps {
  searchParams: Promise<{ rep?: string; q?: string; show?: string }>;
}

type QuoteSearch =
  | { kind: 'none' }
  | { kind: 'number'; quoteNumber: number }
  | { kind: 'customer'; customerIds: readonly string[]; moreCustomers: boolean };

async function resolveSearch(text: string): Promise<QuoteSearch> {
  if (text === '') return { kind: 'none' };
  const quoteNumber = parseQuoteNumber(text);
  if (quoteNumber !== undefined) return { kind: 'number', quoteNumber };
  const query = new URLSearchParams({ q: text, limit: String(CUSTOMER_SEARCH_MAX_LIMIT) });
  const { items, total } = await fetchParsed(
    `/crm/customers?${query.toString()}`,
    customerSearchResponseSchema,
  );
  return {
    kind: 'customer',
    customerIds: items.map((customer) => customer.id),
    moreCustomers: total > items.length,
  };
}

async function loadQuotes(rep: string | undefined, search: QuoteSearch): Promise<QuoteListItem[]> {
  if (search.kind === 'customer' && search.customerIds.length === 0) return [];
  const query = new URLSearchParams();
  if (search.kind === 'number') query.set('quoteNumber', String(search.quoteNumber));

  if (search.kind === 'customer') {
    for (const id of search.customerIds) query.append('customerId', id);
  }

  if (rep !== undefined) query.set('salesRep', rep);
  const path = query.size === 0 ? '/quoting/quotes' : `/quoting/quotes?${query.toString()}`;
  const { items } = await fetchParsed(path, quoteListResponseSchema);
  return items;
}

function listHref(params: { rep: string; q: string; show: QuoteShow }): string {
  const query = new URLSearchParams({ rep: params.rep });
  if (params.q !== '') query.set('q', params.q);
  if (params.show !== 'open') query.set('show', params.show);
  return `/quoting/quotes?${query.toString()}`;
}

const SEGMENT_STYLE = {
  padding: `${SPACE.sm} ${SPACE.lg}`,
  textDecoration: 'none',
  color: COLOR.text,
  fontSize: FONT_SIZE.sm,
} as const;

const QUEUE_COLUMNS = [
  { label: 'Quote' },
  { label: 'Customer' },
  { label: 'Status' },
  { label: 'Next' },
  { label: 'With' },
  { label: 'Waiting', num: true },
] as const;

const FOLD_COLUMNS = [
  { label: 'Quote' },
  { label: 'Customer' },
  { label: 'Status' },
  { label: 'What happened' },
  { label: 'When', num: true },
] as const;

export default async function QuoteListPage({ searchParams }: PageProps) {
  const { rep: rawRep, q: rawQ = '', show: rawShow } = await searchParams;
  const searchText = rawQ.trim();
  const show = parseShow(rawShow);

  const me = await loadMe();
  if (me === null) {
    return (
      <PageShell>
        <h1>Quotes</h1>
        <p>
          <a href="/login" style={{ color: COLOR.accent }}>
            Sign in
          </a>{' '}
          to view this page.
        </p>
      </PageShell>
    );
  }

  const now = new Date();
  const [offerableReps, search] = await Promise.all([loadSalesReps(), resolveSearch(searchText)]);

  const rep = rawRep === undefined ? defaultRep(me, offerableReps) : parseRepFilter(rawRep);
  const [workbook, listed, resolvedReps] = await Promise.all([
    loadWorkbook(me, now),
    loadQuotes(rep, search),

    rep === undefined || rep === me.username ? Promise.resolve(null) : loadResolvedReps([rep]),
  ]);

  const workById = new Map(workbook.quotes.map((entry) => [entry.quote.id, entry.work]));
  const workByOrder = new Map(workbook.orders.map((entry) => [entry.order.id, entry.work]));
  const byQuote = ordersByQuote(workbook.orders.map((entry) => entry.order));
  const rows: QueueQuote[] = listed.map((quote) => {
    const orders = byQuote.get(quote.id) ?? [];
    const work =
      workById.get(quote.id) ??
      quoteWork({
        quote,
        orders: orders.flatMap((order) => {
          const orderWork = workByOrder.get(order.id);
          return orderWork === undefined ? [] : [{ id: order.id, work: orderWork }];
        }),
        roles: me.roles,
        now,
      });
    return work.group === 'converted'
      ? { quote, work, order: orders.at(-1), orderCount: orders.length }
      : { quote, work };
  });
  const queue = quoteQueue(rows, show);

  const everyQuote = workbook.quotes.map((entry) => entry.quote);
  const customerName = (id: string) => workbook.customers.get(id)?.name ?? UNKNOWN_CUSTOMER;

  const mineCount = everyQuote.filter((quote) => quote.salesRep === me.username).length;
  const footnote = noRepFootnote(everyQuote, customerName);
  const successor = (row: QueueQuote) => successorOf(row.quote, everyQuote);
  const canWrite = maySalesWrite(me.roles);
  const otherRep = resolvedReps === null || rep === undefined ? null : rep;
  const tableRows = queue.groups.reduce((sum, group) => sum + group.rows.length, 0);

  const customerCell = (customerId: string) => (
    <QueueCell>
      {customerName(customerId)}
      {workbook.customers.get(customerId)?.creditHold === true && (
        <StatusChip tone="problem">Credit hold</StatusChip>
      )}
    </QueueCell>
  );

  return (
    <PageShell>
      <h1>Quotes</h1>
      <PageLede>
        Your quotes, the ones that need you first. Each row says what happens next and who does it.
      </PageLede>

      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: SPACE.lg,
          alignItems: 'flex-end',
          margin: `${SPACE.xl} 0`,
        }}
      >
        <div
          role="group"
          aria-label="Whose quotes"
          style={{
            display: 'inline-flex',
            border: `1px solid ${COLOR.border}`,
            borderRadius: RADIUS,
            overflow: 'hidden',
          }}
        >
          {[
            { label: 'Mine', count: mineCount, value: me.username, current: rep === me.username },
            { label: 'All reps', count: everyQuote.length, value: '', current: rep === undefined },
          ].map((side) => (
            <a
              key={side.label}
              href={listHref({ rep: side.value, q: searchText, show })}
              aria-current={side.current ? 'true' : undefined}
              style={{
                ...SEGMENT_STYLE,
                ...(side.current ? { background: COLOR.accentSoft, fontWeight: 700 } : {}),
              }}
            >
              {side.label} ({side.count})
            </a>
          ))}
        </div>
        <form
          method="get"
          style={{ display: 'flex', flexWrap: 'wrap', gap: SPACE.md, alignItems: 'flex-end' }}
        >
          <input type="hidden" name="rep" value={rep ?? ''} />
          <Field>
            <FieldLabel>Find</FieldLabel>
            <Input
              type="search"
              name="q"
              defaultValue={searchText}
              placeholder="Quote number or customer"
              style={{ padding: SPACE.md }}
            />
          </Field>
          <Field>
            <FieldLabel>Show</FieldLabel>
            <Select name="show" aria-label="Show" defaultValue={show} style={{ padding: SPACE.md }}>
              {SHOW_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </Field>

          <Button>Find</Button>
        </form>
        <span style={{ flex: 1 }} />
        {canWrite && (
          <LinkButton href="/quoting/quotes/new" variant="primary">
            New quote
          </LinkButton>
        )}
      </div>
      {!canWrite && <SectionNote>{ONLY_SALES_STARTS_A_QUOTE}</SectionNote>}

      {otherRep !== null && (
        <DataLine>
          Quotes sold by{' '}
          <SalesRepName
            rep={resolvedReps?.get(otherRep) ?? { username: otherRep, offerable: false }}
          />
          .
        </DataLine>
      )}

      {search.kind === 'customer' && search.moreCustomers && (
        <p style={{ color: COLOR.muted }}>
          More than {CUSTOMER_SEARCH_MAX_LIMIT} customers match that search, so only the quotes of
          the first {CUSTOMER_SEARCH_MAX_LIMIT} are listed. Type more of the name to narrow it.
        </p>
      )}

      {tableRows === 0 && (queue.closed === null || queue.closed.length === 0) ? (
        <EmptyState>
          {searchText === '' ? 'No quotes here yet.' : `No quotes match ${searchText}.`}
        </EmptyState>
      ) : (
        tableRows > 0 && (
          <QueueTable columns={QUEUE_COLUMNS}>
            {queue.groups.map((group) => [
              <QueueGroupRow key={group.id} span={QUEUE_COLUMNS.length}>
                {group.heading}
              </QueueGroupRow>,
              ...group.rows.map(({ quote, work, order, orderCount }) => (
                <tr key={quote.id}>
                  <QueueCell>
                    <RowLink href={quotePage(quote.id)}>{quoteReference(quote)}</RowLink>
                  </QueueCell>
                  {customerCell(quote.customerId)}
                  <QueueCell>
                    <StatusChip tone={GROUP_TONES[group.id]}>
                      {queueChipLabel(quote.status, group.id, orderCount)}
                    </StatusChip>
                  </QueueCell>
                  <QueueCell>
                    {order === undefined ? (
                      work.next
                    ) : (
                      <>
                        <a href={orderPage(order.id)} style={{ color: COLOR.accent }}>
                          {queueName(order, quoteReference(quote))}
                        </a>
                        : {work.next ?? ORDER_STATUS_LABELS[order.status]}
                      </>
                    )}
                  </QueueCell>
                  <QueueCell>{work.with}</QueueCell>
                  <AgeCell late={isLate(work.ageFrom, now)}>{formatAge(work.ageFrom, now)}</AgeCell>
                </tr>
              )),
            ])}
          </QueueTable>
        )
      )}

      {queue.closed !== null && queue.closed.length > 0 && (
        <div style={{ marginTop: SPACE.xl }}>
          <Fold
            summary={`Closed and superseded (${String(queue.closed.length)})`}
            sum={closedSum(queue.closed, successor)}
            open={queue.foldOpen}
          >
            <QueueTable columns={FOLD_COLUMNS}>
              {queue.closed.map((row) => (
                <tr key={row.quote.id}>
                  <QueueCell>
                    <RowLink href={quotePage(row.quote.id)}>{quoteReference(row.quote)}</RowLink>
                  </QueueCell>
                  {customerCell(row.quote.customerId)}
                  <QueueCell>
                    <StatusChip tone={GROUP_TONES.closed}>
                      {QUOTE_STATUS_LABELS[row.quote.status]}
                    </StatusChip>
                  </QueueCell>
                  <QueueCell>{whatHappened(row.quote, successor(row))}</QueueCell>
                  <QueueCell num>{formatDay(row.quote.updatedAt)}</QueueCell>
                </tr>
              ))}
            </QueueTable>
          </Fold>
        </div>
      )}

      {footnote !== null && (
        <p style={{ color: COLOR.muted, fontSize: FONT_SIZE.sm, marginTop: SPACE.xl }}>
          {footnote}
        </p>
      )}
    </PageShell>
  );
}
