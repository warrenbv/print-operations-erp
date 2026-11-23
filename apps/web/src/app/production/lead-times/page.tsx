// Quotes needing a lead time: draft quotes that cannot be sent until Production enters a lead time:
// docs/product/requirements.md (R5).
// Each row links to the quote's lead time panel. The queue is built in apps/web/src/app/production/lead-times/rows.ts.
import { quoteListResponseSchema, quoteReference } from '@erp/types';
import {
  AgeCell,
  COLOR,
  EmptyState,
  PageLede,
  PageShell,
  QueueCell,
  QueueTable,
  RowLink,
} from '@erp/ui';

import { formatAge, formatDay, isLate, LATE_AFTER_DAYS } from '../../../lib/dates';
import { fetchParsed } from '../../../lib/fetch-parsed';
import { loadMe } from '../../../lib/load-me';
import { NO_REP } from '../../../lib/rep-filter';
import { SalesRepName } from '../../../lib/sales-rep-name';
import { loadResolvedReps } from '../../../lib/sales-reps';
import { loadCustomerNames } from '../../quoting/customer-names';
import { leadTimeHref, leadTimeQueue, leadTimeQueueQueries, linesLabel, toldLabel } from './rows';

export const metadata = { title: 'Quotes needing a lead time' };

const COLUMNS = [
  { label: 'Quote' },
  { label: 'Customer' },
  { label: 'Lines' },
  { label: 'Sales rep' },

  { label: 'Told' },
  { label: 'Waiting', num: true },
];

export default async function LeadTimeQueuePage() {
  const me = await loadMe();
  if (me === null) {
    return (
      <PageShell>
        <h1>Quotes needing a lead time</h1>
        <p>
          <a href="/login" style={{ color: COLOR.accent }}>
            Sign in
          </a>{' '}
          to view this page.
        </p>
      </PageShell>
    );
  }

  const reads = await Promise.all(
    leadTimeQueueQueries().map(
      async (query) =>
        (await fetchParsed(`/quoting/quotes?${query}`, quoteListResponseSchema)).items,
    ),
  );
  const quotes = leadTimeQueue(reads);

  const [customers, reps] = await Promise.all([
    loadCustomerNames(quotes.map((q) => q.customerId)),
    loadResolvedReps(quotes.flatMap((q) => (q.salesRep === undefined ? [] : [q.salesRep]))),
  ]);
  const now = new Date();

  return (
    <PageShell>
      <h1>Quotes needing a lead time</h1>
      <PageLede>
        Draft quotes Sales has started that cannot be sent until Production enters a lead time.
        Oldest first.
      </PageLede>

      {quotes.length === 0 ? (
        <EmptyState>No quote is waiting for a lead time.</EmptyState>
      ) : (
        <QueueTable columns={COLUMNS}>
          {quotes.map((q) => (
            <tr key={q.id}>
              <QueueCell>
                <RowLink href={leadTimeHref(q.id)}>{quoteReference(q)}</RowLink>
              </QueueCell>
              <QueueCell>{customers.get(q.customerId)}</QueueCell>
              <QueueCell>{linesLabel(q.lineCount)}</QueueCell>
              <QueueCell>
                {q.salesRep === undefined ? (
                  NO_REP
                ) : (
                  <SalesRepName
                    rep={reps.get(q.salesRep) ?? { username: q.salesRep, offerable: false }}
                  />
                )}
              </QueueCell>
              <QueueCell>{toldLabel(q.productionToldAt, formatDay)}</QueueCell>
              <AgeCell late={isLate(q.updatedAt, now, LATE_AFTER_DAYS)}>
                {formatAge(q.updatedAt, now)}
              </AgeCell>
            </tr>
          ))}
        </QueueTable>
      )}
    </PageShell>
  );
}
