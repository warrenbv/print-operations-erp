// Customers: search, filter by account rep and page through the customer list.
// A search that names one customer exactly opens that customer.
import { customerSearchResponseSchema, type Customer } from '@erp/types';
import {
  Box,
  Button,
  COLOR,
  DataLine,
  EmptyState,
  PageLede,
  PageShell,
  ResetList,
  SectionNote,
  Select,
  SPACE,
  StatusChip,
} from '@erp/ui';

import { fetchParsed } from '../../../lib/fetch-parsed';
import { onlyDesk } from '../../../lib/helptext';
import { loadMe } from '../../../lib/load-me';
import { Paginator } from '../../../lib/paginator';
import { resolvePaging, showingLine, type Paging } from '../../../lib/paging';
import { CustomerSuggestions, SuggestionCoverage } from '../../../lib/customer-suggestion-list';
import {
  CUSTOMER_LIST_ID,
  jumpToExactCustomer,
  loadCustomerSuggestions,
} from '../../../lib/customer-suggestions';
import { NO_REP, parseRepFilter, REP_FILTER_ANY, repFilterOptions } from '../../../lib/rep-filter';
import { maySalesWrite } from '../../../lib/roles';
import { SalesRepName } from '../../../lib/sales-rep-name';
import { loadResolvedReps, loadSalesReps } from '../../../lib/sales-reps';

export const metadata = { title: 'Customers' };

interface PageProps {
  searchParams: Promise<{ q?: string; rep?: string; page?: string; size?: string }>;
}

async function loadCustomers(
  q: string,
  rep: string | undefined,
  paging: Paging,
): Promise<{
  items: Customer[];
  total: number;
}> {
  const query = new URLSearchParams({
    q,
    limit: String(paging.size),
    offset: String(paging.offset),
  });

  if (rep !== undefined) query.set('accountRepUsername', rep);
  const parsed = await fetchParsed(
    `/crm/customers?${query.toString()}`,
    customerSearchResponseSchema,
  );
  return { items: [...parsed.items], total: parsed.total };
}

export default async function CustomerListPage({ searchParams }: PageProps) {
  const { q = '', rep: rawRep, page, size } = await searchParams;
  const paging = resolvePaging({ page, size });
  const rep = parseRepFilter(rawRep);

  const me = await loadMe();
  if (me === null) {
    return (
      <PageShell>
        <h1>Customers</h1>
        <p>
          <a href="/login" style={{ color: COLOR.accent }}>
            Sign in
          </a>{' '}
          to view this page.
        </p>
      </PageShell>
    );
  }

  const suggestions = await loadCustomerSuggestions();

  jumpToExactCustomer(suggestions.items, q, (customer) => `/crm/customers/${customer.id}`);

  const { items, total } = await loadCustomers(q, rep, paging);
  const showing = showingLine(paging, total, items.length);

  const [offerableReps, resolvedReps] = await Promise.all([
    loadSalesReps(),
    loadResolvedReps([
      ...items.flatMap((c) => (c.accountRepUsername === undefined ? [] : [c.accountRepUsername])),
      ...(rep === undefined ? [] : [rep]),
    ]),
  ]);
  const selectedRep =
    rep === undefined ? undefined : (resolvedReps.get(rep) ?? { username: rep, offerable: false });

  const canWrite = maySalesWrite(me.roles);

  return (
    <PageShell>
      <h1>Customers</h1>

      <PageLede>Every account. Search by name or account number.</PageLede>
      <DataLine>
        {total} match{total === 1 ? '' : 'es'}.{showing !== null && <> {showing}</>}
      </DataLine>

      {canWrite ? (
        <p style={{ margin: `${SPACE.lg} 0` }}>
          <a href="/crm/customers/new" style={{ color: COLOR.accent }}>
            + New customer
          </a>
        </p>
      ) : (
        <SectionNote>{onlyDesk('Sales', 'adds or edits a customer')}</SectionNote>
      )}

      <form method="get" style={{ margin: `${SPACE.xl} 0`, display: 'flex', gap: SPACE.md }}>
        <input
          type="text"
          name="q"
          defaultValue={q}
          placeholder="Search name or account number"
          list={CUSTOMER_LIST_ID}
          style={{ flex: 1, padding: SPACE.md, fontFamily: 'inherit' }}
        />
        <Select
          name="rep"
          defaultValue={rep ?? REP_FILTER_ANY}
          aria-label="Account rep"
          style={{ padding: SPACE.md }}
        >
          {repFilterOptions(offerableReps, selectedRep).map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
        <Button>Search</Button>
      </form>
      <CustomerSuggestions items={suggestions.items} />
      <SuggestionCoverage shown={suggestions.items.length} total={suggestions.total} />

      {items.length === 0 ? (
        <EmptyState>No customers matched.</EmptyState>
      ) : (
        <ResetList gap={SPACE.md}>
          {items.map((c) => (
            <li key={c.id}>
              <Box style={{ padding: '0.6rem 0.9rem', display: 'block' }}>
                <a href={`/crm/customers/${c.id}`} style={{ color: COLOR.accent }}>
                  <strong>{c.name}</strong>
                </a>
                {c.legacyAccountNumber !== undefined && (
                  <span style={{ color: COLOR.muted, marginLeft: SPACE.lg }}>
                    Legacy account #{c.legacyAccountNumber}
                  </span>
                )}

                {c.creditHold && <StatusChip tone="danger">Credit hold</StatusChip>}

                <span style={{ color: COLOR.muted, marginLeft: SPACE.lg }}>
                  {c.accountRepUsername === undefined ? (
                    NO_REP
                  ) : (
                    <SalesRepName
                      rep={
                        resolvedReps.get(c.accountRepUsername) ?? {
                          username: c.accountRepUsername,
                          offerable: false,
                        }
                      }
                    />
                  )}
                </span>
              </Box>
            </li>
          ))}
        </ResetList>
      )}

      <Paginator
        basePath="/crm/customers"
        params={{ q, rep, size }}
        paging={paging}
        total={total}
      />
    </PageShell>
  );
}
