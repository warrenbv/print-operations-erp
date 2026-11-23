// Approvals: everything waiting on a decision, in two queues, price approvals and credit-hold exceptions.
// Everyone may read it. The decision forms show only to the roles that may decide:
// docs/product/roles.md and docs/product/requirements.md (R2, R6, R7).
// Price decisions are drawn by apps/web/src/app/approvals/components/price-override-review.tsx.
import type { ReactNode } from 'react';

import {
  PRICE_OVERRIDE_APPROVAL_ROLES,
  pendingApprovalListResponseSchema,
  quoteWithLinesSchema,
  salesRepLabel,
  type PendingApproval,
  type QuoteWithLines,
  type ResolvedSalesRep,
} from '@erp/types';
import {
  Box,
  Button,
  COLOR,
  DataLine,
  ErrorBanner,
  Field,
  FieldLabel,
  FONT_SIZE,
  PageLede,
  PageShell,
  ResetList,
  SectionNote,
  SPACE,
} from '@erp/ui';

import { onlyDesk } from '../../lib/helptext';
import { loadMe } from '../../lib/load-me';
import { mayDecideCreditException, mayOverrideFloor } from '../../lib/roles';
import { loadCustomerNames } from '../quoting/customer-names';
import { fetchParsed } from '../../lib/fetch-parsed';
import { formatAge, isLate } from '../../lib/dates';
import { approveCreditHoldAction, rejectCreditHoldAction } from './actions';
import {
  approvalAskers,
  approvalCustomerIds,
  orderKinds,
  partitionApprovals,
  type ApprovalKind,
} from './derive';
import { loadResolvedReps } from '../../lib/sales-reps';
import { PriceOverrideReview } from './components/price-override-review';

export const metadata = { title: 'Approvals' };

interface PageProps {
  searchParams: Promise<{ error?: string }>;
}

async function loadPending(): Promise<readonly PendingApproval[]> {
  const { items } = await fetchParsed('/approvals/pending', pendingApprovalListResponseSchema);

  return items;
}

async function loadQuoteDetails(ids: readonly string[]): Promise<Map<string, QuoteWithLines>> {
  const entries = await Promise.all(
    ids.map(async (id): Promise<readonly [string, QuoteWithLines | null]> => {
      const quote = await fetchParsed(
        `/quoting/quotes/${encodeURIComponent(id)}`,
        quoteWithLinesSchema,
        { notFound: 'null' },
      );
      return [id, quote];
    }),
  );
  return new Map(
    entries.filter((entry): entry is readonly [string, QuoteWithLines] => entry[1] !== null),
  );
}

export default async function ApprovalsPage({ searchParams }: PageProps) {
  const { error } = await searchParams;

  const me = await loadMe();
  if (me === null) {
    return (
      <PageShell>
        <h1>Approvals</h1>
        <p>
          <a href="/login" style={{ color: COLOR.accent }}>
            Sign in
          </a>{' '}
          to view this page.
        </p>
      </PageShell>
    );
  }

  const items = await loadPending();
  const partitioned = partitionApprovals(items);
  const { creditHolds, priceOverrides } = partitioned;
  const [quoteDetails, customerNames, askers] = await Promise.all([
    loadQuoteDetails(priceOverrides.map((p) => p.quoteId)),
    loadCustomerNames(approvalCustomerIds(items)),

    loadResolvedReps(approvalAskers(items)),
  ]);
  const now = new Date();

  const canDecideCredit = mayDecideCreditException(me.roles);

  const canDecidePrice = PRICE_OVERRIDE_APPROVAL_ROLES.some((role) => me.roles.includes(role));

  const canDecideFloor = mayOverrideFloor(me.roles);

  const kinds: Record<ApprovalKind, { title: string; count: number; body: () => ReactNode }> = {
    exceptions: {
      title: 'Exceptions',
      count: creditHolds.length,
      body: () => (
        <>
          <SectionNote>
            {canDecideCredit
              ? 'Approving permits one quote and leaves the hold on.'
              : onlyDesk('the Billing Manager', 'decides these')}
          </SectionNote>
          <ResetList>
            {creditHolds.map((item) => (
              <li key={item.approvalId}>
                <Box style={rowStyle}>
                  <div>
                    <a href={`/crm/customers/${item.customerId}`} style={{ color: COLOR.accent }}>
                      <strong>{customerNames.get(item.customerId) ?? item.customerId}</strong>
                    </a>
                    <span style={{ color: COLOR.muted, marginLeft: SPACE.lg }}>on credit hold</span>
                  </div>

                  <p style={{ margin: `${SPACE.xs} 0` }}>
                    <strong>Quote this account anyway:</strong> {item.reason}
                  </p>
                  <AskedLine
                    asker={askerName(askers, item.requestedBy)}
                    requestedAt={item.requestedAt}
                    now={now}
                  />

                  {canDecideCredit && (
                    <div style={{ display: 'flex', gap: SPACE.xl, marginTop: '0.6rem' }}>
                      <form action={approveCreditHoldAction}>
                        <input type="hidden" name="approvalId" value={item.approvalId} />
                        <Button variant="primary">Approve — permits one quote</Button>
                      </form>

                      <form
                        action={rejectCreditHoldAction}
                        style={{ display: 'flex', gap: SPACE.md, flex: 1, alignItems: 'flex-end' }}
                      >
                        <input type="hidden" name="approvalId" value={item.approvalId} />

                        <div style={{ flex: 1 }}>
                          <Field>
                            <FieldLabel>Why the account stays on hold (required)</FieldLabel>
                            <input
                              type="text"
                              name="reason"
                              style={{ padding: SPACE.sm, fontFamily: 'inherit' }}
                            />
                          </Field>
                        </div>
                        <Button>Reject</Button>
                      </form>
                    </div>
                  )}
                </Box>
              </li>
            ))}
          </ResetList>
        </>
      ),
    },
    'price-approvals': {
      title: 'Price approvals',
      count: priceOverrides.length,
      body: () => (
        <>
          <SectionNote>
            {canDecidePrice
              ? "A hand-set price is the Billing Manager's to decide. A line below the floor is an Admin's."
              : onlyDesk('the Billing Manager', 'approves a hand-set price')}
          </SectionNote>
          {priceOverrides.map((pending) => (
            <PriceOverrideReview
              key={pending.quoteId}
              pending={pending}
              full={quoteDetails.get(pending.quoteId)}
              customerName={customerNames.get(pending.customerId) ?? pending.customerId}
              salesRep={pending.salesRep === undefined ? undefined : askers.get(pending.salesRep)}
              canDecide={canDecidePrice}
              canDecideFloor={canDecideFloor}
              waiting={<Waiting requestedAt={pending.requestedAt} now={now} />}
            />
          ))}
        </>
      ),
    },
  };

  return (
    <PageShell>
      <h1>Approvals</h1>

      <PageLede>
        Everything waiting on a decision. Deciding is the manager&apos;s; reading is
        everyone&apos;s.
      </PageLede>

      <DataLine>
        {items.length} item{items.length === 1 ? '' : 's'} awaiting a decision.
      </DataLine>

      <ErrorBanner message={error} />

      {orderKinds(partitioned).map((kind) => {
        const { title, count, body } = kinds[kind];

        return count === 0 ? (
          <p key={kind} id={kind} style={emptyKind}>
            <strong>{title}</strong>{' '}
            <span style={{ color: COLOR.muted }}>Nothing else is waiting.</span>
          </p>
        ) : (
          <div key={kind} id={kind}>
            <h2 style={queueTitle}>{title}</h2>
            {body()}
          </div>
        );
      })}
    </PageShell>
  );
}

function askerName(askers: ReadonlyMap<string, ResolvedSalesRep>, username: string): string {
  const resolved = askers.get(username);
  return resolved === undefined ? username : salesRepLabel(resolved);
}

function AskedLine({ asker, requestedAt, now }: { asker: string; requestedAt: string; now: Date }) {
  return (
    <p style={{ margin: 0, color: COLOR.muted }}>
      Asked by {asker} · <Waiting requestedAt={requestedAt} now={now} />
    </p>
  );
}

function Waiting({ requestedAt, now }: { requestedAt: string; now: Date }) {
  return (
    <span style={isLate(requestedAt, now) ? lateStyle : undefined}>
      Waiting: {formatAge(requestedAt, now)}
    </span>
  );
}

const rowStyle = { padding: '0.7rem 0.9rem', gap: '0.1rem' } as const;

const queueTitle = { fontSize: FONT_SIZE.lg, marginTop: SPACE.xxl } as const;

const emptyKind = { marginTop: SPACE.xl, marginBottom: 0 } as const;

const lateStyle = { color: COLOR.warning, fontWeight: 600 } as const;
