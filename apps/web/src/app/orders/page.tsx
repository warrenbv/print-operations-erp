// Orders: every order with its status, its next act and the desk it waits on: docs/product/requirements.md (R12).
// Filtered by status and sales rep and sorted by the reader's choice. The rows are built in apps/web/src/app/orders/docket.ts.
import { ORDER_STATUSES, orderListResponseSchema, type Order } from '@erp/types';
import {
  AgeCell,
  Button,
  COLOR,
  DataLine,
  EmptyState,
  Field,
  FieldLabel,
  PageLede,
  PageShell,
  QueueCell,
  QueueTable,
  RowLink,
  Select,
  SPACE,
  StatusChip,
} from '@erp/ui';

import { loadMe } from '../../lib/load-me';
import { loadCustomerNames } from '../quoting/customer-names';
import { fetchParsed } from '../../lib/fetch-parsed';
import { defaultRep, parseRepFilter, REP_FILTER_ANY, repFilterOptions } from '../../lib/rep-filter';
import { loadResolvedReps, loadSalesReps } from '../../lib/sales-reps';
import { loadWorkbook } from '../../lib/work/load-workbook';
import {
  DOCKET_SORTS,
  buildOrderQuery,
  docketRows,
  filterValue,
  isDocketSort,
  parseFilter,
  sortDocket,
  type DocketFilter,
  type DocketSort,
} from './docket';
import { ORDER_STATUS_LABELS } from './format';
import { loadQuoteReferences } from './quote-references';

export const metadata = { title: 'Orders' };

interface PageProps {
  searchParams: Promise<{ filter?: string; sort?: string; rep?: string }>;
}

async function loadDocket(filter: DocketFilter, rep: string | undefined): Promise<Order[]> {
  const query = buildOrderQuery(filter, rep);
  const { items } = await fetchParsed(
    query === '' ? '/orders' : `/orders?${query}`,
    orderListResponseSchema,
  );
  return [...items];
}

const SORT_LABELS: Record<DocketSort, string> = {
  requested: 'Delivery date',
  job: 'Job number',
  customer: 'Customer',
  status: 'Status',
};

const COLUMNS = [
  { label: 'Order' },
  { label: 'Customer' },
  { label: 'Status' },
  { label: 'Next' },
  { label: 'With' },
  { label: 'Waiting', num: true },
] as const;

export default async function OrdersPage({ searchParams }: PageProps) {
  const { filter: rawFilter, sort: rawSort, rep: rawRep } = await searchParams;

  const me = await loadMe();
  if (me === null) {
    return (
      <PageShell>
        <h1>Orders</h1>
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
  const filter = parseFilter(rawFilter);
  const sort: DocketSort = rawSort !== undefined && isDocketSort(rawSort) ? rawSort : 'requested';

  const offerableReps = await loadSalesReps();
  const rep = rawRep === undefined ? defaultRep(me, offerableReps) : parseRepFilter(rawRep);

  const [orders, workbook] = await Promise.all([loadDocket(filter, rep), loadWorkbook(me, now)]);

  const [customerNames, resolvedReps, quoteRefs] = await Promise.all([
    loadCustomerNames(orders.map((o) => o.customerId)),
    loadResolvedReps(rep === undefined ? [] : [rep]),

    loadQuoteReferences(orders),
  ]);
  const selectedRep =
    rep === undefined ? undefined : (resolvedReps.get(rep) ?? { username: rep, offerable: false });

  const rows = docketRows(sortDocket(orders, sort, customerNames), {
    work: new Map(workbook.orders.map((entry) => [entry.order.id, entry.work])),
    customerNames,
    quoteRefs,
    now,
  });

  return (
    <PageShell>
      <h1>Orders</h1>

      <PageLede>Every order from conversion to confirmation. Open one to move it.</PageLede>
      <DataLine>
        {rows.length} order{rows.length === 1 ? '' : 's'}
        {filter.kind === 'status' && ` in ${ORDER_STATUS_LABELS[filter.status].toLowerCase()}`}.
      </DataLine>

      <form
        method="get"
        style={{
          margin: `${SPACE.xl} 0`,
          display: 'flex',
          gap: SPACE.md,
          alignItems: 'flex-end',
        }}
      >
        <Field>
          <FieldLabel>Show</FieldLabel>
          <Select
            name="filter"
            aria-label="Show"
            defaultValue={filterValue(filter)}
            style={{ padding: SPACE.md }}
          >
            <option value="all">All orders</option>

            {ORDER_STATUSES.map((status) => (
              <option key={status} value={status}>
                {ORDER_STATUS_LABELS[status]}
              </option>
            ))}
          </Select>
        </Field>

        <Field>
          <FieldLabel>Sort</FieldLabel>
          <Select name="sort" aria-label="Sort" defaultValue={sort} style={{ padding: SPACE.md }}>
            {DOCKET_SORTS.map((s) => (
              <option key={s} value={s}>
                Sort by {SORT_LABELS[s].toLowerCase()}
              </option>
            ))}
          </Select>
        </Field>

        <Field>
          <FieldLabel>Sales rep</FieldLabel>
          <Select
            name="rep"
            aria-label="Sales rep"
            defaultValue={rep ?? REP_FILTER_ANY}
            style={{ padding: SPACE.md }}
          >
            {repFilterOptions(offerableReps, selectedRep).map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </Field>
        <Button>Apply</Button>
      </form>

      <QueueTable columns={COLUMNS}>
        {rows.length === 0 ? (
          <tr>
            <td colSpan={COLUMNS.length}>
              <EmptyState>No orders to show.</EmptyState>
            </td>
          </tr>
        ) : (
          rows.map((row) => (
            <tr key={row.id}>
              <QueueCell>
                <RowLink href={row.href}>{row.name}</RowLink>
              </QueueCell>
              <QueueCell>{row.customer}</QueueCell>
              <QueueCell>
                <StatusChip tone={row.tone}>{row.status}</StatusChip>
              </QueueCell>
              <QueueCell>{row.next ?? '—'}</QueueCell>
              <QueueCell>{row.with ?? '—'}</QueueCell>
              <AgeCell late={row.late}>{row.waiting}</AgeCell>
            </tr>
          ))
        )}
      </QueueTable>
    </PageShell>
  );
}
