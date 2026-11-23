// A contact as its label and, where it adds something, its email, by the rules in apps/web/src/lib/contact-line.ts.
import type { Contact } from '@erp/types';

import { contactLine } from './contact-line';

export function ContactLineText({ contact }: { contact: Pick<Contact, 'name' | 'email'> }) {
  const line = contactLine(contact);
  return (
    <>
      <strong>{line.label}</strong>
      {line.email !== undefined && <> · {line.email}</>}
    </>
  );
}
