// The recipient check on every send. A send form posts the addresses it showed, and the API refuses with
// `recipient-changed` when the contacts tagged for that document no longer match: apps/api/src/crm/confirm-recipient.ts.
// A quote goes only to the contacts tagged for quotes: docs/product/requirements.md (R1).
// apps/api/test/every-send-confirms-its-recipient.test.ts holds every send route to this.
import type { CSSProperties } from 'react';

export const CONFIRM_RECIPIENTS_FIELD = 'confirmRecipients';

export const CONFIRM_RECIPIENTS_SHOWN_FIELD = 'confirmRecipientsShown';

export function recipientListLabel(addresses: readonly string[]): string {
  return addresses.join(', ');
}

export const RECIPIENT_BUTTON_STYLE: CSSProperties = {
  whiteSpace: 'normal',
  textAlign: 'left',
  maxWidth: '100%',
};

export function readConfirmRecipients(formData: FormData): string[] {
  return formData
    .getAll(CONFIRM_RECIPIENTS_FIELD)
    .map((value) => String(value))
    .filter((value) => value !== '');
}

/**
 * The `confirmRecipients` part of a send body. A form that showed an empty list posts an empty list,
 * which the API checks like any other. Only a form that rendered no list posts nothing, and the API then skips the check.
 */
export function confirmRecipientsBody(
  formData: FormData,
): { confirmRecipients: string[] } | Record<string, never> {
  if (formData.get(CONFIRM_RECIPIENTS_SHOWN_FIELD) === null) {
    return {};
  }
  return { confirmRecipients: readConfirmRecipients(formData) };
}
