// Help sentences shared by several pages, so one rule reads the same everywhere it is stated.
// Sentences that restrict an act name the desk, never a person: docs/product/roles.md.
import { RECEIVED_DOCUMENT_MAX_MB } from './received-document';

export function onlyDesk(desk: string, act: string): string {
  return `Only ${desk} ${act}.`;
}

export const ONLY_SALES_STARTS_A_QUOTE = onlyDesk('Sales', 'starts a quote');

export const ONLY_SALES_OR_BILLING_SETS_QUOTE_DEFAULTS = onlyDesk(
  'Sales or the Billing Manager',
  'sets the quote defaults',
);

// A hold blocks quote creation until the Billing Manager approves an exception: docs/product/requirements.md (R2).
export const CREDIT_HOLD_SENTENCE =
  'On credit hold. No quote can be created for this account until the Billing Manager approves it.';

// A document goes only to contacts tagged for it, so with nobody tagged it cannot be sent: docs/product/requirements.md (R1).
export function nobodyTagged(document: string, tag: string): string {
  return (
    `Nobody on this account is tagged to receive ${document}, so there is nobody to send it to. ` +
    `Open the customer, edit the contact who should get them, and tick ${tag}.`
  );
}

export const ATTACHING_ADDS_A_FILE = 'Adds a file. It never replaces one.';

export const RECEIVED_DOCUMENT_HINT = `PDF, image, Word or Excel, up to ${String(RECEIVED_DOCUMENT_MAX_MB)} MB.`;

export const SHARED_MAILBOX_HINT =
  'Leave blank for a shared mailbox. Its email shows in its place.';

export const WASHINGTON_JURISDICTION_HINT =
  'Washington needs WA- and the four-digit DOR code, such as WA-0202.';

export const DEFAULT_TAX_JURISDICTION_HINT =
  'ID, or WA- and the four-digit DOR location code, such as WA-0202 for Clarkston.';

export const RATE_OVERRIDE_HINT = 'Blank uses the configured rate.';

export const CARRIER_BID_HINT = 'Blank until the bid arrives.';

export const FREIGHT_MARGIN_PERCENT_HINT = '12 means 12 percent.';

export const DELIVERY_DATE_REFUSAL = 'Enter the delivery date as a calendar date, like 2026-09-14.';
