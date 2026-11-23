// Confirm removing one contact. The removal posts the contact's `lockVersion`: docs/decisions/006-optimistic-concurrency.md.
import { notFound } from 'next/navigation';

import { contactLabel, contactListResponseSchema } from '@erp/types';
import { Button, COLOR, DL, ErrorBanner, PageShell, SectionNote, SPACE } from '@erp/ui';

import { onlyDesk } from '../../../../../../../lib/helptext';
import { loadMe } from '../../../../../../../lib/load-me';
import { maySalesWrite } from '../../../../../../../lib/roles';
import { deleteContactAction } from '../../actions';
import { loadContact } from '../../load-contact';
import { MISSING_RECORD_TITLE, recordTitle } from '../../../../../../../lib/record-title';

interface PageProps {
  params: Promise<{ id: string; contactId: string }>;
  searchParams: Promise<{ error?: string }>;
}

export async function generateMetadata({ params }: PageProps) {
  const { id, contactId } = await params;
  const title = await recordTitle(
    `/crm/customers/${encodeURIComponent(id)}/contacts`,
    contactListResponseSchema,
    ({ items }) => {
      const contact = items.find((candidate) => candidate.id === contactId);
      return contact === undefined
        ? MISSING_RECORD_TITLE
        : `Remove contact ${contactLabel(contact)}`;
    },
    'Remove contact',
  );
  return { title };
}

export default async function RemoveContactPage({ params, searchParams }: PageProps) {
  const { id, contactId } = await params;
  const { error } = await searchParams;

  const me = await loadMe();
  if (me === null) {
    return (
      <PageShell>
        <h1>Remove contact</h1>
        <p>
          <a href="/login" style={{ color: COLOR.accent }}>
            Sign in
          </a>{' '}
          to view this page.
        </p>
      </PageShell>
    );
  }

  const contact = await loadContact(id, contactId);
  if (contact === 'not-found') {
    notFound();
  }

  const canWrite = maySalesWrite(me.roles);

  return (
    <PageShell>
      <h1>Remove contact</h1>
      <BackLink id={id} />

      <ErrorBanner message={error} />

      <p>This removes the contact from the customer. It cannot be undone.</p>

      <DL style={{ margin: `${SPACE.xl} 0 0` }}>
        <dt style={{ color: COLOR.muted }}>Name</dt>
        <dd style={{ margin: 0 }}>
          {contact.name ?? <span style={{ color: COLOR.muted }}>none on file</span>}
        </dd>
        <dt style={{ color: COLOR.muted }}>Email</dt>
        <dd style={{ margin: 0 }}>
          {contact.email ?? <span style={{ color: COLOR.muted }}>none on file</span>}
        </dd>
        <dt style={{ color: COLOR.muted }}>Phone</dt>
        <dd style={{ margin: 0 }}>
          {contact.phone ?? <span style={{ color: COLOR.muted }}>none on file</span>}
        </dd>
      </DL>

      {canWrite ? (
        <form action={deleteContactAction} style={{ marginTop: '1.25rem' }}>
          <input type="hidden" name="customerId" value={id} />
          <input type="hidden" name="contactId" value={contact.id} />

          <input type="hidden" name="lockVersion" value={contact.lockVersion} />
          <div style={{ display: 'flex', gap: SPACE.md }}>
            <Button>Remove contact</Button>
            <a
              href={`/crm/customers/${encodeURIComponent(id)}`}
              style={{ color: COLOR.accent, alignSelf: 'center' }}
            >
              Cancel
            </a>
          </div>
        </form>
      ) : (
        <SectionNote>{onlyDesk('Sales', 'removes a contact')}</SectionNote>
      )}
    </PageShell>
  );
}

function BackLink({ id }: { id: string }) {
  return (
    <p style={{ marginBottom: SPACE.md }}>
      <a href={`/crm/customers/${encodeURIComponent(id)}`} style={{ color: COLOR.accent }}>
        ← Back to customer
      </a>
    </p>
  );
}
