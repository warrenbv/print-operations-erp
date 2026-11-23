// The customer page: terms, addresses, contacts and their tags, quote defaults, the credit hold, and every
// quote and order for the account.
// Starting a quote here respects the credit hold. A held account needs an approved, unspent exception first:
// docs/product/requirements.md (R2). The exception state is read by apps/web/src/app/quoting/credit-exception.ts.
import { Fragment } from 'react';

import { notFound } from 'next/navigation';

import {
  contactListResponseSchema,
  customerSchema,
  orderListResponseSchema,
  quoteListResponseSchema,
  formatMoney,
  type Contact,
  type Customer,
  type Order,
  type Quote,
  quoteReference,
  shortId,
} from '@erp/types';
import {
  Box,
  Button,
  COLOR,
  DangerBanner,
  DataLine,
  DL,
  EmptyState,
  ErrorBanner,
  FONT_SIZE,
  InfoBanner,
  PageLede,
  PageShell,
  ResetList,
  Section,
  SectionNote,
  SPACE,
  StatusChip,
} from '@erp/ui';

import { fetchParsed } from '../../../../lib/fetch-parsed';
import { CREDIT_HOLD_SENTENCE, onlyDesk } from '../../../../lib/helptext';
import { loadMe } from '../../../../lib/load-me';
import { SalesRepName } from '../../../../lib/sales-rep-name';
import { loadResolvedRep } from '../../../../lib/sales-reps';
import {
  maySalesWrite,
  maySetAgreedPrice,
  maySetCreditHold,
  mayWriteCustomerDefaults,
} from '../../../../lib/roles';
import { ORDER_STATUS_LABELS } from '../../../orders/format';
import { QUOTE_STATUS_LABELS } from '../../../quoting/format';
import { formatDay, formatTimestamp } from '../../../../lib/dates';
import { addressLines } from '../../../../lib/address';
import { loadOrderAmounts } from '../../../orders/order-amounts';
import { SUBMISSION_TOKEN_FIELD, mintSubmissionToken } from '../../../../lib/submission-token';
import { CONTACT_ROLE_LABELS } from '../../../../lib/contact-roles';
import { ContactLineText } from '../../../../lib/contact-line-text';
import { DefaultsSection } from './defaults-section';
import { loadCustomerDefaults } from '../../../../lib/customer-defaults';
import { loadGrades } from '../../../quoting/load-grades';
import { loadTiers } from '../../../quoting/load-tiers';
import { createContactAction } from './contacts/actions';
import { ContactFormFields } from './contacts/contact-form';
import { CreditHoldSection } from './credit-hold-section';
import { freightMarginPercent } from './freight-margin';
import { recordTitle } from '../../../../lib/record-title';
import { creditExceptionState, mayStartQuote } from '../../../quoting/credit-exception';
import { CreditExceptionSection } from '../../../quoting/credit-hold-notice';
import { loadCreditApprovalsFor } from '../../../quoting/load-credit-approvals';
import { createQuoteAction } from '../../../quoting/quotes/new/actions';

interface PageProps {
  params: Promise<{ id: string }>;

  searchParams: Promise<{
    error?: string;
    notice?: string;
  }>;
}

async function loadCustomer(id: string): Promise<Customer | 'not-found'> {
  const customer = await fetchParsed(`/crm/customers/${encodeURIComponent(id)}`, customerSchema, {
    notFound: 'null',
  });
  return customer ?? 'not-found';
}

async function loadContacts(id: string): Promise<Contact[]> {
  const { items } = await fetchParsed(
    `/crm/customers/${encodeURIComponent(id)}/contacts`,
    contactListResponseSchema,
  );
  return [...items];
}

async function loadOrders(id: string): Promise<Order[]> {
  const { items } = await fetchParsed(
    `/orders?customerId=${encodeURIComponent(id)}`,
    orderListResponseSchema,
  );

  return [...items];
}

async function loadQuotes(id: string): Promise<Quote[]> {
  const { items } = await fetchParsed(
    `/quoting/quotes?customerId=${encodeURIComponent(id)}`,
    quoteListResponseSchema,
  );
  return [...items].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function generateMetadata({ params }: PageProps) {
  const { id } = await params;
  const title = await recordTitle(
    `/crm/customers/${encodeURIComponent(id)}`,
    customerSchema,
    (customer) => customer.name,
    'Customer',
  );
  return { title };
}

export default async function CustomerProfilePage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const { error, notice } = await searchParams;

  const me = await loadMe();
  if (me === null) {
    return (
      <PageShell>
        <h1>Customer</h1>
        <p>
          <a href="/login" style={{ color: COLOR.accent }}>
            Sign in
          </a>{' '}
          to view this page.
        </p>
      </PageShell>
    );
  }

  const customerResult = await loadCustomer(id);
  if (customerResult === 'not-found') {
    notFound();
  }
  const customer = customerResult;

  const [contacts, defaults, orders, quotes, accountRep] = await Promise.all([
    loadContacts(id),

    loadCustomerDefaults(id),
    loadOrders(id),
    loadQuotes(id),

    loadResolvedRep(customer.accountRepUsername),
  ]);
  const amounts = await loadOrderAmounts(orders.map((order) => order.id));

  const grades = defaults.parts.length === 0 ? [] : await loadGrades();

  const tiers = defaults.tierCode === undefined ? [] : await loadTiers();

  const canWrite = maySalesWrite(me.roles);

  const canSetCreditHold = maySetCreditHold(me.roles);

  const canWriteDefaults = mayWriteCustomerDefaults(me.roles);

  const canSetAgreedPrice = maySetAgreedPrice(me.roles);

  return (
    <PageShell>
      <p style={{ marginBottom: SPACE.md }}>
        <a href="/crm/customers" style={{ color: COLOR.accent }}>
          ← Customers
        </a>
      </p>

      <ErrorBanner message={error} />

      <InfoBanner>{notice}</InfoBanner>

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          gap: SPACE.xl,
          flexWrap: 'wrap',
        }}
      >
        <h1 style={{ marginBottom: 0 }}>{customer.name}</h1>
        {canWrite && (
          <a
            href={`/crm/customers/${encodeURIComponent(customer.id)}/edit`}
            style={{ color: COLOR.accent }}
          >
            Edit customer
          </a>
        )}
      </div>

      <PageLede>
        The account in full: terms, addresses, contacts, and every quote and order.
      </PageLede>
      <DataLine>
        {customer.legacyAccountNumber !== undefined && (
          <>Legacy account #{customer.legacyAccountNumber}</>
        )}
        {customer.legacyUmbrellaAccountNumber !== undefined && (
          <> · Umbrella {customer.legacyUmbrellaAccountNumber}</>
        )}
      </DataLine>

      {customer.creditHold && (
        <DangerBanner>
          {CREDIT_HOLD_SENTENCE}
          {customer.creditHoldSetBy !== undefined && (
            <span style={{ color: COLOR.muted }}>
              {' '}
              Set by {customer.creditHoldSetBy}
              {customer.creditHoldSetAt !== undefined &&
                ` on ${formatDay(customer.creditHoldSetAt)}`}
              .
            </span>
          )}
        </DangerBanner>
      )}

      {canWrite && <StartQuoteAct customer={customer} />}

      <Section title="Terms & tax">
        <DL>
          <dt>Payment terms</dt>
          <dd>Net {customer.paymentTerms.netDays}</dd>

          <dt>Freight margin (%)</dt>
          <dd>
            {freightMarginPercent(customer.freightMarginPct) ?? (
              <em style={{ color: COLOR.muted }}>None</em>
            )}
          </dd>

          <dt>Account rep</dt>
          <dd>
            {accountRep === undefined ? (
              <em style={{ color: COLOR.muted }}>None</em>
            ) : (
              <SalesRepName rep={accountRep} />
            )}
          </dd>

          <dt>Tax jurisdiction</dt>
          <dd>{customer.taxJurisdiction ?? <em style={{ color: COLOR.muted }}>not set</em>}</dd>

          <dt>Tax status</dt>
          <dd>
            {customer.taxExempt ? 'Exempt' : 'Taxable'}
            {customer.reseller && ' · Reseller'}
            {customer.taxExemptionDocRef !== undefined && (
              <span style={{ color: COLOR.muted }}> ({customer.taxExemptionDocRef})</span>
            )}
          </dd>
        </DL>
      </Section>

      {canSetCreditHold && <CreditHoldSection customer={customer} />}

      <Section title="Billing address">
        {customer.billingAddress === undefined ? (
          <EmptyState>Not on file.</EmptyState>
        ) : (
          <address style={{ fontStyle: 'normal', lineHeight: 1.6 }}>
            {addressLines(customer.billingAddress).map((line, index) => (
              <Fragment key={index}>
                {index > 0 && <br />}
                {line}
              </Fragment>
            ))}
          </address>
        )}
      </Section>

      <Section title="Shipping address">
        {customer.shippingAddress === undefined ? (
          <EmptyState>Not on file.</EmptyState>
        ) : (
          <address style={{ fontStyle: 'normal', lineHeight: 1.6 }}>
            {addressLines(customer.shippingAddress).map((line, index) => (
              <Fragment key={index}>
                {index > 0 && <br />}
                {line}
              </Fragment>
            ))}
          </address>
        )}
      </Section>

      <DefaultsSection
        customerId={customer.id}
        defaults={defaults}
        grades={grades}
        tiers={tiers}
        canWrite={canWriteDefaults}
        canSetAgreedPrice={canSetAgreedPrice}
      />

      <Section
        id="contacts"
        title={`Contacts (${contacts.length})`}
        note="Tags say who receives each document. Everyone tagged for a document gets a copy."
      >
        {contacts.length === 0 ? (
          <EmptyState>No contacts on file.</EmptyState>
        ) : (
          <ResetList gap={SPACE.sm}>
            {contacts.map((c) => (
              <li key={c.id}>
                <ContactLineText contact={c} />
                {c.phone !== undefined && <> · {c.phone}</>}

                {c.roles.map((assignment) => (
                  <Fragment key={assignment.role}>
                    {' '}
                    <StatusChip tone="success">{CONTACT_ROLE_LABELS[assignment.role]}</StatusChip>
                  </Fragment>
                ))}
                {canWrite && (
                  <>
                    {' '}
                    <a
                      href={`/crm/customers/${encodeURIComponent(customer.id)}/contacts/${encodeURIComponent(c.id)}/edit`}
                      style={linkStyle}
                    >
                      Edit
                    </a>{' '}
                    <a
                      href={`/crm/customers/${encodeURIComponent(customer.id)}/contacts/${encodeURIComponent(c.id)}/remove`}
                      style={linkStyle}
                    >
                      Remove
                    </a>
                  </>
                )}
              </li>
            ))}
          </ResetList>
        )}

        {!canWrite && (
          <div style={{ marginTop: SPACE.xl }}>
            <SectionNote>{onlyDesk('Sales', 'adds or edits a contact')}</SectionNote>
          </div>
        )}
        {canWrite && (
          <form action={createContactAction} style={{ marginTop: SPACE.xl }}>
            <input type="hidden" name="customerId" value={customer.id} />

            <input type="hidden" name={SUBMISSION_TOKEN_FIELD} value={mintSubmissionToken()} />
            <ContactFormFields />
            <Button style={{ marginTop: SPACE.md }}>Add contact</Button>
          </form>
        )}
      </Section>

      <Section title={`Quotes (${quotes.length})`}>
        {quotes.length === 0 ? (
          <EmptyState>No quotes yet.</EmptyState>
        ) : (
          <ResetList gap={SPACE.md}>
            {quotes.map((quote) => (
              <li key={quote.id}>
                <Box style={{ padding: '0.6rem 0.9rem', display: 'block' }}>
                  <strong>
                    <a href={`/quoting/quotes/${quote.id}`} style={{ color: COLOR.accent }}>
                      {quoteReference(quote)}
                    </a>
                  </strong>
                  <span style={{ marginLeft: SPACE.lg }}>{QUOTE_STATUS_LABELS[quote.status]}</span>
                  <span style={{ color: COLOR.muted, marginLeft: SPACE.lg }}>
                    updated {formatTimestamp(quote.updatedAt)}
                  </span>
                </Box>
              </li>
            ))}
          </ResetList>
        )}
      </Section>

      <Section title={`Orders (${orders.length})`}>
        {orders.length === 0 ? (
          <EmptyState>No orders yet.</EmptyState>
        ) : (
          <ResetList gap={SPACE.md}>
            {orders.map((order) => {
              const amount = amounts.get(order.id);
              return (
                <li key={order.id}>
                  <Box style={{ padding: '0.6rem 0.9rem', display: 'block' }}>
                    <strong>
                      <a href={`/orders/${order.id}`} style={{ color: COLOR.accent }}>
                        {order.jobNumber ?? shortId(order.id)}
                      </a>
                    </strong>
                    <span style={{ marginLeft: SPACE.lg }}>
                      {ORDER_STATUS_LABELS[order.status]}
                    </span>
                    <span style={{ color: COLOR.muted, marginLeft: SPACE.lg }}>
                      {formatTimestamp(order.createdAt)}
                    </span>

                    <span style={{ marginLeft: SPACE.lg }}>
                      {amount === undefined ? (
                        <em style={{ color: COLOR.muted }}>(unknown amount)</em>
                      ) : (
                        <>
                          {formatMoney(amount.amount)}
                          {amount.freightPending && (
                            <span
                              style={{ color: COLOR.muted }}
                              title="A carrier bid has not arrived yet"
                            >
                              {' '}
                              (freight not final)
                            </span>
                          )}
                        </>
                      )}
                    </span>
                  </Box>
                </li>
              );
            })}
          </ResetList>
        )}
      </Section>
    </PageShell>
  );
}

// Offers the start only when the hold allows it. The API checks the hold again when the quote is
// created: modules/quoting/src/services/quote-service.ts.
async function StartQuoteAct({ customer }: { customer: Customer }) {
  const approvals = await loadCreditApprovalsFor(customer.creditHold ? [customer.id] : []);
  const state = creditExceptionState(customer, approvals.get(customer.id) ?? []);
  return (
    <div style={{ marginTop: SPACE.lg }}>
      {mayStartQuote(state) && (
        <form action={createQuoteAction}>
          <input type="hidden" name="customerId" value={customer.id} />
          <input type="hidden" name="from" value="customer" />
          {customer.accountRepUsername !== undefined && (
            <input type="hidden" name="salesRep" value={customer.accountRepUsername} />
          )}
          <Button variant="primary">Start a quote for this customer</Button>
        </form>
      )}

      <CreditExceptionSection customer={customer} state={state} from="customer" />
    </div>
  );
}

const linkStyle = { color: COLOR.accent, fontSize: FONT_SIZE.sm } as const;
