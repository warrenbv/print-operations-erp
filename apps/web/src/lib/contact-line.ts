// A contact's printed label and the email shown beside it.
// A contact with no name is labelled by its email (`contactLabel` in packages/types/src/contact.ts), so the email is not repeated.
import { contactLabel, type Contact } from '@erp/types';

export interface ContactLine {
  label: string;

  email?: string;
}

export function contactLine(contact: Pick<Contact, 'name' | 'email'>): ContactLine {
  const label = contactLabel(contact);
  return contact.name === null || contact.email === undefined
    ? { label }
    : { label, email: contact.email };
}
