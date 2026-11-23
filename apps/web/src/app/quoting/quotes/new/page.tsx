// Step 1 of New quote: find the customer and start the quote from their row: docs/product/requirements.md (R1).
// A customer on credit hold shows the hold and the exception panel, and Start quote only with an
// approved exception to spend: docs/product/requirements.md (R2).
// Only Sales starts a quote (docs/product/roles.md).
import type { Customer, QuoteApproval, SalesRep } from '@erp/types';
import {
  Box,
  Button,
  COLOR,
  DataLine,
  EmptyState,
  ErrorBanner,
  Field,
  FieldLabel,
  Fold,
  FONT_SIZE,
  InfoBanner,
  PageLede,
  PageShell,
  ResetList,
  SectionNote,
  Select,
  SPACE,
  StatusChip,
} from '@erp/ui';

import { ONLY_SALES_STARTS_A_QUOTE } from '../../../../lib/helptext';
import { loadMe } from '../../../../lib/load-me';
import { Paginator } from '../../../../lib/paginator';
import { resolvePaging, type Paging } from '../../../../lib/paging';
import { NEW_QUOTE_RETURN, RETURN_TO_FIELD } from '../../../../lib/return-to';
import { maySalesWrite } from '../../../../lib/roles';
import { loadSalesReps, repOptions, resolveFromOfferable } from '../../../../lib/sales-reps';
import { CustomerSuggestions, SuggestionCoverage } from '../../../../lib/customer-suggestion-list';
import { CUSTOMER_LIST_ID, loadCustomerSuggestions } from '../../../../lib/customer-suggestions';
import { creditExceptionState, mayStartQuote } from '../../credit-exception';
import { CreditExceptionSection, CreditHoldNotice } from '../../credit-hold-notice';
import { loadCreditApprovalsFor } from '../../load-credit-approvals';
import { StepsHeader } from '../[id]/components/steps-header';
import { newQuoteSteps } from '../[id]/steps';
import { createQuoteAction } from './actions';
import {
  DIRECTORY_HREF,
  DIRECTORY_LINK_LABEL,
  loadCustomerStep,
  SEARCH_FIRST_SENTENCE,
  type CustomerStep,
} from './customer-step';

export const metadata = { title: 'New quote' };

const LEDE = 'Find the customer, then start the quote from their row. Lines and pricing come next.';

interface PageProps {
  searchParams: Promise<{
    q?: string;
    error?: string;
    notice?: string;
    page?: string;
    size?: string;
  }>;
}

export default async function NewQuotePage({ searchParams }: PageProps) {
  const { q = '', error, notice, page, size } = await searchParams;
  const paging = resolvePaging({ page, size });

  const me = await loadMe();
  if (me === null) {
    return (
      <PageShell>
        <h1>New quote</h1>
        <p>
          <a href="/login" style={{ color: COLOR.accent }}>
            Sign in
          </a>{' '}
          to view this page.
        </p>
      </PageShell>
    );
  }

  const canWrite = maySalesWrite(me.roles);
  if (!canWrite) {
    return (
      <PageShell>
        <h1>New quote</h1>
        <PageLede>{LEDE}</PageLede>
        <SectionNote>{ONLY_SALES_STARTS_A_QUOTE}</SectionNote>
      </PageShell>
    );
  }

  const suggestions = await loadCustomerSuggestions();

  const step = await loadCustomerStep(q, paging);
  const customers = step.kind === 'results' ? step.customers : [];

  const approvals = await loadCreditApprovalsFor(
    customers.filter((c) => c.creditHold).map((c) => c.id),
  );

  const reps: readonly SalesRep[] = customers.length === 0 ? [] : await loadSalesReps();

  return (
    <PageShell>
      <p style={{ margin: `0 0 ${SPACE.md}`, fontSize: FONT_SIZE.sm, color: COLOR.muted }}>
        <a href="/quoting/quotes" style={{ color: COLOR.accent }}>
          Quotes
        </a>{' '}
        / New quote
      </p>

      <h1>New quote</h1>
      <PageLede>{LEDE}</PageLede>

      <ErrorBanner message={error} />
      <InfoBanner>{notice}</InfoBanner>

      <StepsHeader steps={newQuoteSteps()} />

      <form
        method="get"
        style={{
          margin: `${SPACE.lg} 0`,
          display: 'flex',
          gap: SPACE.md,
          alignItems: 'flex-end',
        }}
      >
        <div style={{ flex: 1 }}>
          <Field>
            <FieldLabel>Customer name or account number</FieldLabel>

            <input
              type="text"
              name="q"
              defaultValue={q}
              list={CUSTOMER_LIST_ID}
              style={{ padding: SPACE.md, fontFamily: 'inherit' }}
            />
          </Field>
        </div>
        <Button>Search</Button>
      </form>
      <CustomerSuggestions items={suggestions.items} />
      <SuggestionCoverage shown={suggestions.items.length} total={suggestions.total} />

      {step.kind === 'prompt' && <EmptyState>{SEARCH_FIRST_SENTENCE}</EmptyState>}

      <p style={{ marginBottom: SPACE.lg, display: 'flex', gap: SPACE.lg, flexWrap: 'wrap' }}>
        <a href={DIRECTORY_HREF} style={{ color: COLOR.accent }}>
          {DIRECTORY_LINK_LABEL}
        </a>
        <a
          href={`/crm/customers/new?${RETURN_TO_FIELD}=${encodeURIComponent(NEW_QUOTE_RETURN)}`}
          style={{ color: COLOR.accent }}
        >
          New customer
        </a>
      </p>

      {step.kind === 'results' && (
        <CustomerResults
          step={step}
          q={q}
          size={size}
          paging={paging}
          approvals={approvals}
          reps={reps}
        />
      )}
    </PageShell>
  );
}

function CustomerResults({
  step,
  q,
  size,
  paging,
  approvals,
  reps,
}: {
  step: Extract<CustomerStep, { kind: 'results' }>;
  q: string;
  size: string | undefined;
  paging: Paging;
  approvals: ReadonlyMap<string, QuoteApproval[]>;
  reps: readonly SalesRep[];
}) {
  return (
    <>
      {step.showing !== null && <DataLine>{step.showing}</DataLine>}

      {step.customers.length === 0 ? (
        <EmptyState>No customers matched.</EmptyState>
      ) : (
        <ResetList gap={SPACE.md}>
          {step.customers.map((c) => {
            const state = creditExceptionState(c, approvals.get(c.id) ?? []);
            const head = <RowHead customer={c} />;
            return (
              <li key={c.id}>
                <Box style={{ display: 'grid', gap: SPACE.md }}>
                  {mayStartQuote(state) ? (
                    <form action={createQuoteAction} style={{ display: 'grid', gap: SPACE.md }}>
                      <input type="hidden" name="customerId" value={c.id} />

                      <input type="hidden" name="q" value={q} />
                      <div style={ROW_HEAD_STYLE}>
                        {head}
                        <Button variant="primary">Start quote</Button>
                      </div>

                      {c.creditHold && <CreditHoldNotice customer={c} />}
                      <RepAndNotesFold customer={c} reps={reps} />
                    </form>
                  ) : (
                    <>
                      <div style={ROW_HEAD_STYLE}>{head}</div>
                      {c.creditHold && <CreditHoldNotice customer={c} />}
                    </>
                  )}

                  <CreditExceptionSection customer={c} state={state} q={q} />
                </Box>
              </li>
            );
          })}
        </ResetList>
      )}

      <Paginator
        basePath="/quoting/quotes/new"
        params={{ q, size }}
        paging={paging}
        total={step.total}
      />
    </>
  );
}

function RowHead({ customer }: { customer: Customer }) {
  return (
    <div>
      <strong>{customer.name}</strong>
      {customer.legacyAccountNumber !== undefined && (
        <span style={{ color: COLOR.muted, marginLeft: SPACE.lg }}>
          Legacy account #{customer.legacyAccountNumber}
        </span>
      )}
      {customer.creditHold && (
        <>
          {' '}
          <StatusChip tone="danger">Credit hold</StatusChip>
        </>
      )}
    </div>
  );
}

function RepAndNotesFold({ customer, reps }: { customer: Customer; reps: readonly SalesRep[] }) {
  const stored =
    customer.accountRepUsername === undefined
      ? undefined
      : resolveFromOfferable(customer.accountRepUsername, reps);
  const options = repOptions(reps, stored);
  const repLabel =
    options.find((choice) => choice.value === customer.accountRepUsername)?.label ?? 'No sales rep';
  return (
    <Fold summary="Add a note or change the rep" sum={`${repLabel} · no note`}>
      <div style={{ display: 'flex', gap: SPACE.md, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <Field>
          <FieldLabel>Sales rep</FieldLabel>
          <RepPicker customer={customer} options={options} />
        </Field>
        <div style={{ flex: 1, minWidth: 160 }}>
          <Field>
            <FieldLabel>Notes (optional)</FieldLabel>
            <input
              type="text"
              name="notes"
              style={{ padding: '0.35rem 0.5rem', fontFamily: 'inherit' }}
            />
          </Field>
        </div>
      </div>
    </Fold>
  );
}

function RepPicker({
  customer,
  options,
}: {
  customer: Customer;
  options: readonly { value: string; label: string }[];
}) {
  return (
    <Select
      name="salesRep"

      aria-label="Sales rep"
      defaultValue={customer.accountRepUsername ?? ''}
      style={{ minWidth: 180 }}
    >
      <option value="">No sales rep</option>
      {options.map((choice) => (
        <option key={choice.value} value={choice.value}>
          {choice.label}
        </option>
      ))}
    </Select>
  );
}

const ROW_HEAD_STYLE = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'baseline',
  gap: SPACE.lg,
  flexWrap: 'wrap',
} as const;
