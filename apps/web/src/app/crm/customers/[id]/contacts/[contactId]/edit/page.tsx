// Edit one contact, its details and tags. Sales and Admin may. The save goes through
// `updateContactAction` in apps/web/src/app/crm/customers/[id]/contacts/actions.ts.
import { notFound } from 'next/navigation';

import { contactLabel, contactListResponseSchema } from '@erp/types';
import { Button, COLOR, ErrorBanner, PageLede, PageShell, SPACE } from '@erp/ui';

import { onlyDesk } from '../../../../../../../lib/helptext';
import { loadMe } from '../../../../../../../lib/load-me';
import { maySalesWrite } from '../../../../../../../lib/roles';
import { updateContactAction } from '../../actions';
import { ContactFormFields } from '../../contact-form';
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
      return contact === undefined ? MISSING_RECORD_TITLE : `Edit ${contactLabel(contact)}`;
    },
    'Edit contact',
  );
  return { title };
}

export default async function EditContactPage({ params, searchParams }: PageProps) {
  const { id, contactId } = await params;
  const { error } = await searchParams;

  const me = await loadMe();
  if (me === null) {
    return (
      <PageShell>
        <h1>Edit contact</h1>
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
  if (!canWrite) {
    return (
      <PageShell>
        <h1>{contactLabel(contact)}</h1>

        <PageLede>{onlyDesk('Sales', 'edits a contact')}</PageLede>
        <BackLink id={id} />
      </PageShell>
    );
  }

  return (
    <PageShell>
      <h1>{contactLabel(contact)}</h1>

      <PageLede>Edit the contact. Blanking a field clears it.</PageLede>
      <BackLink id={id} />

      <ErrorBanner message={error} />

      <form action={updateContactAction} style={formStyle}>
        <input type="hidden" name="customerId" value={id} />
        <input type="hidden" name="contactId" value={contact.id} />

        <input type="hidden" name="lockVersion" value={contact.lockVersion} />
        <ContactFormFields contact={contact} />
        <div style={{ display: 'flex', gap: SPACE.md }}>
          <Button>Save contact</Button>
          <a
            href={`/crm/customers/${encodeURIComponent(id)}`}
            style={{ color: COLOR.accent, alignSelf: 'center' }}
          >
            Cancel
          </a>
        </div>
      </form>
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

const formStyle = { display: 'grid', gap: SPACE.lg, marginTop: SPACE.xl } as const;
