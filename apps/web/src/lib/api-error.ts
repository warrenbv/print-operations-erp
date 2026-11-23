// Turns an API refusal into one sentence a person can act on, for the banner a server action redirects to.
// The API names each refusal with a stable `reason` token. REASON_GLOSS says what it means and what to do next.
// The raw message shows only for a token with no gloss, and apps/web/src/lib/reason-gloss-coverage.test.ts fails when one is missing.
// Field names in validation errors are worded by apps/web/src/lib/field-labels.ts.
import { CONTACT_NEEDS_NAME_OR_EMAIL, TAX_JURISDICTION_KEY_FORMAT } from '@erp/types';

import { fieldLabel } from './field-labels';

const UNKNOWN_TAX_JURISDICTION_REMEDY = `Use ${TAX_JURISDICTION_KEY_FORMAT}. Settings > Tax rates lists the codes loaded.`;

/**
 * What each refusal `reason` means and what to do next, keyed by the API's token.
 * A gloss is written to follow "Could not …: " and must fit the 200-character cut in `readableApiError`.
 */
export const REASON_GLOSS: Readonly<Record<string, string>> = {
  'below-floor':
    'a line is below the margin floor, so the quote cannot be sent until an Admin overrides the floor.',

  'customer-billing-address-required':
    'that customer has no billing address, and one is required to quote. Open the customer from Customers, edit it, add the billing address, then start the quote again.',

  'customer-on-credit-hold':
    'that account is on credit hold, so a quote cannot be raised for it. A Billing Manager can approve an exception; ask for one, then start the quote again.',

  'customer-not-on-credit-hold':
    'that account is not on credit hold, so there is no exception to approve.',

  'unspent-approval-exists':
    'that account already holds an approved exception, so a quote can be started for it now. Nothing further is needed - go back and start the quote.',
  'approval-already-decided':
    'that request has already been decided. Reload the page to see the answer.',

  'override-already-approved':
    'that hand-set price has already been approved, so the quote has left the queue. Reload the page. To reopen it, the salesperson edits the line, which revokes the approval and asks afresh.',

  'unsupported-document-type':
    'only a PDF can be attached here. Save or export the file as a PDF, then attach it again.',

  'duplicate-footage-variant': 'the same footage variant is listed twice.',

  'duplicate-stock-width': 'the same stock width is listed twice.',

  'duplicate-legacy-account-number':
    'another customer already holds that legacy account number. Clear it there first, or check whether this is the same account.',
  'duplicate-grade-code': 'that grade code already exists in this family.',

  'duplicate-tier-code': 'another tier already uses that code. Codes are permanent — pick another.',
  'duplicate-tier-threshold':
    'another tier already starts at that pallet count. Two tiers cannot share a threshold, because which one applies would depend on row order.',
  'footage-variant-in-use':
    'draft quotes still use that footage variant, so it cannot be removed or renamed yet — re-point those quote lines first.',
  'stock-width-in-use':
    'draft quotes still use that stock width, so it cannot be removed yet — change those quote lines first.',

  'invalid-transition': 'that status change is not allowed from here.',

  'foreign-origin':
    'the request came from a page outside this application, so the API refused it. Open the application at its own address and try again.',

  'confirmation-details-required':
    'a committed lead time is required to confirm an order - enter one and confirm again.',
  'order-not-confirmed':
    'the order has not been confirmed yet, so it has no job number and no committed lead time to state. Confirm it first.',

  'no-pallet-fit-for-width': 'no pallet fit is configured for that roll width.',

  'width-not-stocked':
    'a line has a width its paper is not stocked in. Pick one of its widths, or choose Custom width and type the width.',

  'no-quote-recipient':
    'nobody on that account is tagged to receive quotes, so there is nobody to send this to. Open the customer from Customers, edit the contact who should get them, and tick Quote.',
  'no-order-confirmation-recipient':
    'nobody on that account is tagged to receive order confirmations, so there is nobody to send this to. Open the customer from Customers, edit the right contact, and tick Order confirmation.',

  'contact-role-unreachable':
    'that person cannot hold one of the tags you ticked. Quote and order confirmation need an email address, and production needs a phone or an email. Add the missing detail first.',

  'contact-needs-name-or-email': CONTACT_NEEDS_NAME_OR_EMAIL,

  'relay-refused':
    'the mail relay refused the message, and sending it again will be refused the same way. Check the address on the customer, then try again - if it is right, this needs IT.',
  'relay-unreachable':
    'the mail relay could not be reached, so nothing was sent and nothing was lost. Try again in a few minutes; if it keeps failing, tell IT.',
  'send-not-recorded':
    'the email went out to the customer, but the ERP did not record that it was sent. Do not send it again. Give IT the quote number.',

  'document-storage-unavailable':
    'the ERP’s document storage failed for a reason it could not name. It is not your figures. Try again once; if it fails again, tell IT: document storage, and which screen.',

  'no-tier-for-volume': 'no pricing tier covers that pallet volume.',

  'no-zero-threshold-tier':
    'one tier must start at 0 pallets, or a small quote has no tier at all. Give another tier the 0 threshold first.',
  'nothing-to-approve': 'there is no pending price approval on this quote.',

  'nothing-below-floor':
    'no line on this quote is below the floor any more, so there is no floor to override. Reload the page.',
  'floor-override-already-approved':
    'an Admin has already overridden the floor on this quote. Reload the page. Editing the lines revokes the override and asks afresh.',
  'floor-override-reason-required': 'a floor override needs a reason, approved or rejected.',
  'override-not-approved': 'a hand-set price on this quote still needs Billing approval.',

  'quote-has-order': 'this quote has already become an order, so it cannot be closed as lost.',

  'quote-has-no-lead-time':
    'this quote has no lead time, and one is required before it reaches a customer. Ask Production to enter it; a quote already sent takes one only through a revision.',

  'quote-needs-lead-time':
    'a quote needs a lead time before it can be sent. Ask Production to enter it on the quote, then send it.',
  'quote-not-editable': 'this quote can no longer be edited.',

  'quote-not-printable':
    'this quote has not been sent, so there is no client-ready document yet. A PDF is indistinguishable from a sent quote once somebody holds it, so one exists only once the quote goes out.',
  'quote-not-revisable': 'only a sent quote can be revised.',
  'quote-version-conflict': 'a newer version of this quote already exists.',

  'stale-aggregate':
    'this changed while you were reading it, so nothing was saved. Reload and check the new figures before trying again.',
  'rejection-reason-required': 'a rejection needs a reason.',

  'redistribution-not-confirmed':
    'the customer already holds a version of this quote, so it was not sent again. Use "Send another copy" below to send it anyway.',
  'unknown-customer': 'that customer no longer exists.',
  'unknown-footage-variant': 'that footage variant is not on the grade.',
  'unknown-grade-on-line': 'a line references a grade that no longer exists.',

  'unknown-tax-jurisdiction': `no tax rate is loaded for that tax jurisdiction, so nothing was saved. ${UNKNOWN_TAX_JURISDICTION_REMEDY}`,
  'unknown-tier-code': 'that pricing tier does not exist.',

  'unknown-quote':
    'that quote cannot be converted. It may have been revised, closed or removed since this page was opened - open the quote and convert its current version.',
  'empty-quote':
    'that quote has no lines, so there is nothing to turn into an order. Add and price at least one line first.',
  'quote-fails-send-checks':
    'this quote no longer passes the checks a sent quote must pass (margin floor, price approval, lead time), so it cannot become an order. Revise the quote and send the new version.',

  'unknown-quote-line':
    'a line on this page is not on the quote any more. Open the quote again and create the order from its current lines.',
  'per-pound-line-needs-pounds':
    'a line sold by the pound was chosen without its pounds ordered. Enter the pounds ordered for it, more than 0.',

  'line-jurisdiction-mismatch':
    'a line’s tax jurisdiction is in a different state from where that line is delivered. Change the tax jurisdiction or the delivery address so the tax matches where the goods are going.',

  'per-pound-needs-roll-weight':
    'a line priced per pound has an estimated roll weight of zero, so there is no price per pound to work out. Check the grade’s basis weight and the line’s footage, or price that line per roll.',

  'per-pound-order-needs-roll-weight':
    'a quote line priced per pound has no estimated roll weight, so the order cannot work out what it is worth per roll. Open the quote, re-save that line, then convert again.',
  'per-pound-hand-set-price':
    'a line priced per pound also carries a hand-set price per roll, which are two different prices for the same line. Clear the hand-set price, or set that line back to per roll.',

  'per-roll-hand-set-pound-price':
    'a line priced per roll carries a hand-set price per pound, which is a price in a basis that line is not sold in. Clear that price, or set the line to per pound.',

  'per-pound-needs-ordered-weight':
    'a line priced per pound has no pounds ordered. Enter the pounds the customer’s PO orders.',
  'per-roll-ordered-weight':
    'a line priced per roll carries pounds ordered, which only a per-pound line has. Clear the pounds ordered, or set the line to per pound.',

  'entered-margin-below-floor':
    'a margin entered manually is under the margin floor, which may have been raised since this page was opened. Reload the quote, then enter a margin at or above the floor, or choose a tier.',
  'entered-margin-hand-set-price':
    'a line carries both a margin entered manually and a hand-set price, which are two different prices for the same line. Clear the hand-set price, or choose a tier.',
  'entered-margin-tier-override':
    'a line carries both a margin entered manually and a chosen tier. Choose one of them in the Pricing tier drop-down.',

  'recipient-changed':
    'the contacts tagged to receive this changed while this page was open, so nothing was sent. Reload and confirm who should receive it.',

  'document-too-large':
    'that file is too large to attach. Export or save a smaller PDF and attach it again.',
  'no-file': 'no file was chosen, so there was nothing to attach. Pick a file, then attach it.',

  'invalid-credentials': 'that username and password were not accepted. Check both and try again.',
  'directory-unreachable':
    'the staff directory could not be reached, so nothing was read or changed. Try again in a few minutes; if it keeps failing, tell IT.',

  'empty-customer-id': 'the link is missing the customer it was meant to filter on.',
  'invalid-customer-id':
    'the customer in that link is not readable. Pick the customer from the list instead.',
  'empty-sales-rep': 'the link is missing the sales rep it was meant to filter on.',
  'invalid-usernames':
    'the sales reps in that request are not readable. Reload the page; if it happens again, tell IT which screen.',
  'invalid-sales-rep':
    'the sales rep in that link is not readable. Choose the rep from the filter instead.',
  'empty-quote-id': 'the link is missing the quote it was meant to open.',
  'invalid-quote-id':
    'the quote in that link is not readable. Open it from the quote list instead.',
  'invalid-quote-number':
    'the quote number in that link cannot be searched for. Use the search box on the page.',
  'invalid-lead-time-filter':
    'that link asks for quotes by lead time in a way this page cannot read. Open the quotes needing a lead time from Production.',

  'invalid-converted-filter':
    'that link asks for quotes by whether they became orders in a way this page cannot read. Open Quotes and choose what to show there.',

  'invalid-count':
    'that link asks for a count in a way this page cannot read. Open the list itself.',
  'invalid-count-query':
    'that link asks for a count and for rows at once, and a count has no rows. Open the list itself.',
  'invalid-limit':
    'that link asks for a number of rows this page cannot serve (1 to 200). Open the list itself.',
  'invalid-sort':
    'that link names an order this page does not have (oldest or newest). Open the list itself.',
  'empty-po-number': 'the link is missing the PO number it was meant to search for.',
  'invalid-po-number':
    'the PO number in that link cannot be searched for. Use the search box on the page.',
  'invalid-ids':
    'that link asks for a list of records in a form this page cannot read. Use the page’s own filters.',
  'invalid-status': 'that link names a status this page does not have. Choose one from the filter.',
};

const STORAGE_NOT_WRITABLE =
  'the ERP could not file the document: its document storage is not writable. It is not your figures. Trying again will fail the same way until IT fixes it; tell IT: document storage, and which screen.';

// A finer gloss when the refusal's `value` names a sub-case. It wins over the reason's own gloss.
export const REASON_VALUE_GLOSS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  'relay-refused': {
    'left-quoted':
      'the mail relay refused the message, so the email did not go out, but the quote shows as sent. Check the address on the customer before sending again; if it is right, tell IT.',
  },
  'relay-unreachable': {
    'left-quoted':
      'the mail relay could not be reached, so the email did not go out, but the quote shows as sent. Send it again from the quote in a few minutes; if it keeps failing, tell IT.',
  },
  'document-storage-unavailable': {
    'not-writable': STORAGE_NOT_WRITABLE,
    full: STORAGE_NOT_WRITABLE,
    'not-a-directory': STORAGE_NOT_WRITABLE,
    missing:
      'the stored copy of this document is not where the ERP filed it. Nothing is lost on the record; tell IT: document storage, and which document.',
  },
};

// A gloss built from an object `value`, so the banner can name the line and the code at fault.
// It returns `undefined` when the figures are not there, and the plain gloss is used instead.
export const REASON_FIGURES_GLOSS: Readonly<
  Record<string, (figures: Readonly<Record<string, unknown>>) => string | undefined>
> = {
  'unknown-tax-jurisdiction': ({ lineNumber, taxJurisdiction }) =>
    typeof taxJurisdiction === 'string'
      ? `no tax rate is loaded for ${taxJurisdiction}` +
        (typeof lineNumber === 'number' ? ` on line ${String(lineNumber)}` : '') +
        `, so nothing was saved. ${UNKNOWN_TAX_JURISDICTION_REMEDY}`
      : undefined,
};

function valueGloss(reason: string, value: unknown): string | undefined {
  if (typeof value === 'string') return REASON_VALUE_GLOSS[reason]?.[value];
  if (value !== null && typeof value === 'object') {
    return REASON_FIGURES_GLOSS[reason]?.(value as Readonly<Record<string, unknown>>);
  }
  return undefined;
}

// Sentences for a bare status that carries only the framework's default wording, listed in `nest`.
// A body with a `reason` never falls back here, so a deliberate refusal is not reworded.
const STATUS_FALLBACK: ReadonlyMap<
  number,
  { readonly nest: readonly string[]; readonly gloss: string }
> = new Map([
  [
    403,
    {
      nest: ['Forbidden', 'Forbidden resource'],
      gloss:
        'your account does not have the role this action needs. Ask an Admin to grant it if you should be able to do this.',
    },
  ],
  [
    404,
    {
      nest: ['Not Found'],
      gloss:
        'that record is no longer there - it may have been removed since this page was opened. Reload and check before trying again.',
    },
  ],
  [
    500,
    {
      nest: ['Internal server error'],
      gloss:
        'something went wrong on the server and nothing was saved. It is not your figures. Try again, and if it happens again tell IT which screen you were on and roughly when.',
    },
  ],
  [
    413,
    {
      nest: ['request entity too large'],
      gloss:
        'that was more than the server takes in one go, so nothing was saved. Send less at a time, and if it happens again tell IT which screen you were on.',
    },
  ],
]);

function statusFallback(
  status: number,
  body: Record<string, unknown>,
  detail: string,
): string | null {
  if (typeof body['reason'] === 'string') return null;
  const entry = STATUS_FALLBACK.get(status);
  if (entry === undefined) return null;
  return entry.nest.includes(detail) ? entry.gloss : null;
}

function fieldMessage(field: string, message: string): string {
  const label = fieldLabel(field);
  return message === 'Required' ? `${label} is required` : `${label}: ${message}`;
}

// Validation issues arrive as an array, as an array wrapped in `message`, or flattened into `formErrors` and `fieldErrors`.
function readableValidationError(body: unknown): string | null {
  const parts: string[] = [];

  if (Array.isArray(body)) {
    for (const raw of body) {
      if (raw === null || typeof raw !== 'object') continue;
      const issue = raw as { path?: unknown; message?: unknown };
      if (typeof issue.message !== 'string') continue;

      const path = Array.isArray(issue.path) ? issue.path.join('.') : '';
      parts.push(path === '' ? issue.message : fieldMessage(path, issue.message));
    }
    return parts.length === 0 ? null : parts.join('; ');
  }

  if (body === null || typeof body !== 'object') return null;

  const wrapped = (body as { message?: unknown }).message;
  if (Array.isArray(wrapped)) return readableValidationError(wrapped);

  const flat = body as { formErrors?: unknown; fieldErrors?: unknown };

  if (Array.isArray(flat.formErrors)) {
    for (const message of flat.formErrors) {
      if (typeof message === 'string') parts.push(message);
    }
  }
  if (flat.fieldErrors !== null && typeof flat.fieldErrors === 'object') {
    for (const [field, messages] of Object.entries(flat.fieldErrors as Record<string, unknown>)) {
      if (!Array.isArray(messages)) continue;
      for (const message of messages) {
        if (typeof message === 'string') parts.push(fieldMessage(field, message));
      }
    }
  }

  return parts.length === 0 ? null : parts.join('; ');
}

/**
 * The banner text for a failed API call: `prefix`, then what went wrong.
 * The detail prefers a gloss for the reason's value, then the reason's gloss, then the raw reason, then a
 * validation summary, then a sentence for the bare status. It is cut at 200 characters.
 */
export async function readableApiError(prefix: string, response: Response): Promise<string> {
  let detail = '';
  // A body that is not JSON keeps its raw text as the detail.
  try {
    const text = await response.text();
    detail = text;
    const body: unknown = JSON.parse(text);
    if (body !== null && typeof body === 'object') {
      const record = body as Record<string, unknown>;
      const reason = record['reason'] ?? record['message'] ?? record['error'];
      if (typeof reason === 'string') {
        detail = valueGloss(reason, record['value']) ?? REASON_GLOSS[reason] ?? reason;

        detail = statusFallback(response.status, record, detail) ?? detail;
      } else {
        detail = readableValidationError(body) ?? detail;
      }
    }
  } catch {}

  if (detail === '') {
    detail = STATUS_FALLBACK.get(response.status)?.gloss ?? '';
  }
  const trimmed = detail.length > 200 ? `${detail.slice(0, 200)}…` : detail;
  return trimmed === '' ? `${prefix}.` : `${prefix}: ${trimmed}`;
}
