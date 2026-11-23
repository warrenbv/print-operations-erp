// Reads the contact forms into the API's request shapes. A contact needs a name or an email.
// Tags say which mail a contact receives. A quote goes only to contacts tagged Quote: docs/product/requirements.md (R1).
import {
  CONTACT_NEEDS_NAME_OR_EMAIL,
  createContactRequestSchema,
  deleteContactRequestSchema,
  updateContactRequestSchema,
  type CreateContactRequest,
  type DeleteContactRequest,
  type UpdateContactRequest,
} from '@erp/types';
import { optionalString } from '@erp/utils';

export type Collected<T> = { ok: true; request: T } | { ok: false; message: string };

export const CONTACT_ROLES_FIELD = 'roles';

export function collectDelete(formData: FormData): Collected<DeleteContactRequest> {
  const parsed = deleteContactRequestSchema.safeParse({
    lockVersion: Number(formData.get('lockVersion')),
  });
  if (!parsed.success) {
    return { ok: false, message: firstIssue(parsed.error.issues) };
  }
  return { ok: true, request: parsed.data };
}

export function collectCreate(formData: FormData): Collected<CreateContactRequest> {
  if (
    optionalString(formData, 'name') === undefined &&
    optionalString(formData, 'email') === undefined
  ) {
    return { ok: false, message: CONTACT_NEEDS_NAME_OR_EMAIL };
  }

  const parsed = createContactRequestSchema.safeParse({
    ...optionalField(formData, 'name'),
    ...optionalField(formData, 'email'),
    ...optionalField(formData, 'phone'),
  });
  if (!parsed.success) {
    return { ok: false, message: firstIssue(parsed.error.issues) };
  }
  return { ok: true, request: parsed.data };
}

export function collectUpdate(formData: FormData): Collected<UpdateContactRequest> {
  const name = optionalString(formData, 'name');
  const email = optionalString(formData, 'email');

  if (name === undefined && email === undefined) {
    return { ok: false, message: CONTACT_NEEDS_NAME_OR_EMAIL };
  }

  const parsed = updateContactRequestSchema.safeParse({
    name: name ?? null,
    email: email ?? null,
    phone: optionalString(formData, 'phone') ?? null,

    roles: formData.getAll(CONTACT_ROLES_FIELD).map(String),

    lockVersion: Number(formData.get('lockVersion')),
  });
  if (!parsed.success) {
    return { ok: false, message: firstIssue(parsed.error.issues) };
  }
  return { ok: true, request: parsed.data };
}

function firstIssue(issues: readonly { path: PropertyKey[]; message: string }[]): string {
  const issue = issues[0];
  return issue === undefined ? 'invalid input' : `${issue.path.join('.')}: ${issue.message}`;
}

function optionalField(form: FormData, key: string): Record<string, string> {
  const value = optionalString(form, key);
  return value === undefined ? {} : { [key]: value };
}
