// Step 1 of an existing draft: the customer, the contacts tagged for quotes and the shipping address.
// The quote goes only to contacts tagged for quotes: docs/product/requirements.md (R1).
import { Fragment } from 'react';

import { notFound, redirect } from 'next/navigation';

import {
  contactListResponseSchema,
  quoteReference,
  quoteWithLinesSchema,
  recipientAddressesFor,
} from '@erp/types';
import {
  COLOR,
  DL,
  EmptyState,
  FONT_SIZE,
  LinkButton,
  PageLede,
  PageShell,
  ResetList,
  Section,
  SPACE,
  StatusChip,
  StepStrip,
  WarnBanner,
} from '@erp/ui';

import { addressLines } from '../../../../../lib/address';
import { ContactLineText } from '../../../../../lib/contact-line-text';
import { loadCustomerDefaults } from '../../../../../lib/customer-defaults';
import { fetchParsed } from '../../../../../lib/fetch-parsed';
import { nobodyTagged } from '../../../../../lib/helptext';
import { loadMe } from '../../../../../lib/load-me';
import { recordTitle } from '../../../../../lib/record-title';
import { mayWriteCustomerDefaults } from '../../../../../lib/roles';
import { DefaultsSection } from '../../../../crm/customers/[id]/defaults-section';
import { QUOTE_STATUS_LABELS } from '../../../format';
import { loadGrades } from '../../../load-grades';
import { StepsHeader } from '../components/steps-header';
import { showsLinesStep } from '../derive';
import { loadCustomer, loadQuote, loadTiers } from '../loaders';
import { quoteStrip } from '../record';
import { quoteSteps, stepHrefs } from '../steps';

interface PageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: PageProps) {
  const { id } = await params;
  const title = await recordTitle(
    `/quoting/quotes/${encodeURIComponent(id)}`,
    quoteWithLinesSchema,
    (quote) => `Customer for quote ${quoteReference(quote)}`,
    'Quote',
  );
  return { title };
}

export default async function QuoteCustomerStepPage({ params }: PageProps) {
  const { id } = await params;

  const me = await loadMe();
  if (me === null) {
    return (
      <PageShell>
        <h1>Quote</h1>
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
  if (!showsLinesStep(quote.status)) {
    redirect(`/quoting/quotes/${encodeURIComponent(quote.id)}`);
  }

  const [customer, defaults, contacts] = await Promise.all([
    loadCustomer(quote.customerId),
    loadCustomerDefaults(quote.customerId),
    fetchParsed(
      `/crm/customers/${encodeURIComponent(quote.customerId)}/contacts`,
      contactListResponseSchema,
    ),
  ]);
  if (customer === null) {
    notFound();
  }

  const grades = defaults.parts.length === 0 ? [] : await loadGrades();

  const tiers = defaults.tierCode === undefined ? [] : await loadTiers();

  const quoteContacts = contacts.items.filter((contact) =>
    contact.roles.some((assignment) => assignment.role === 'quote'),
  );

  const nobodyToSendTo = recipientAddressesFor(contacts.items, 'quote').length === 0;
  const customerHref = `/crm/customers/${encodeURIComponent(customer.id)}`;
  const hrefs = stepHrefs(quote.id);

  return (
    <PageShell>
      <p style={{ margin: `0 0 ${SPACE.md}`, fontSize: FONT_SIZE.sm, color: COLOR.muted }}>
        <a href="/quoting/quotes" style={{ color: COLOR.accent }}>
          Quotes
        </a>{' '}
        / {quoteReference(quote)}
      </p>
      <h1>
        Quote {quoteReference(quote)} for {customer.name}
        <StatusChip>{QUOTE_STATUS_LABELS[quote.status]}</StatusChip>
      </h1>

      {quote.notes !== undefined && <PageLede>{quote.notes}</PageLede>}

      <StepStrip steps={quoteStrip({ quote, roles: me.roles, now: new Date() })} />
      <StepsHeader
        steps={quoteSteps({
          quoteId: quote.id,
          customerName: customer.name,
          lines: quote.lines,
          openRows: 0,
          leadTimeDays: quote.leadTimeDays,
          current: 1,
        })}
      />

      <Section title="Account">
        <DL>
          <dt>Payment terms</dt>
          <dd>Net {customer.paymentTerms.netDays}</dd>
        </DL>
      </Section>

      <Section title="Quote contacts">
        {quoteContacts.length > 0 && (
          <ResetList gap={SPACE.sm}>
            {quoteContacts.map((contact) => (
              <li key={contact.id}>
                <ContactLineText contact={contact} />
              </li>
            ))}
          </ResetList>
        )}

        {nobodyToSendTo && (
          <WarnBanner>
            {nobodyTagged('quotes', 'Quote')}{' '}
            <a href={`${customerHref}#contacts`} style={{ color: COLOR.accent }}>
              Open the contacts
            </a>
          </WarnBanner>
        )}
      </Section>

      <Section title="Shipping address" note="Step 3 starts each delivery from this address.">
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
        canWrite={mayWriteCustomerDefaults(me.roles)}
      />

      <div
        style={{
          display: 'flex',
          justifyContent: 'flex-end',
          alignItems: 'center',
          gap: SPACE.md,
          flexWrap: 'wrap',
          borderTop: `1px solid ${COLOR.border}`,
          paddingTop: '0.875rem',
          marginTop: SPACE.xl,
        }}
      >
        <LinkButton href={customerHref}>Open the customer</LinkButton>
        <LinkButton variant="primary" href={hrefs.lines}>
          Continue to lines
        </LinkButton>
      </div>
    </PageShell>
  );
}
