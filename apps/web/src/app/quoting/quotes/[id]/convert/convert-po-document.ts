// Wording and redirects for the customer's PO document on conversion: docs/product/requirements.md (R9).
// The document is attached after the order exists, so a refused attachment leaves the order made and says so.
import { errorUrl, noticeUrl } from '../../../../../lib/redirect-error';

export const DOCUMENT_NOT_ATTACHED = 'The order was created, but the PO document was not attached.';

export const CHOOSE_THE_DOCUMENT_AGAIN = 'Choose the PO document again.';

export function refusedPress(refusal: string, fileChosen: boolean): string {
  return fileChosen ? `${refusal} ${CHOOSE_THE_DOCUMENT_AGAIN}` : refusal;
}

export function documentRefusedUrl(
  orderPath: string,
  refusal: string | undefined,
  notice: string | undefined,
): string {
  const message =
    refusal === undefined ? DOCUMENT_NOT_ATTACHED : `${DOCUMENT_NOT_ATTACHED} ${refusal}`;
  return errorUrl(orderPath, message, {
    field: 'documents',
    ...(notice === undefined ? {} : { notice }),
  });
}

export const PO_MISSING_FIELD = 'poMissing';

export function createdNotice(
  poNumber: string | undefined,
  dates: readonly string[],
  over: string | undefined,
): string {
  const named = dates.map((date) => `delivery ${date}`);
  const last = named.pop() ?? '';
  const list = named.length === 0 ? last : `${named.join(', ')} and ${last}`;
  const po = poNumber === undefined ? '' : ` for PO ${poNumber}`;
  const made = `${String(dates.length)} orders created${po}: ${list}.`;
  return over === undefined ? made : `${made} ${over}`;
}

export function documentMissingSentence(missing: number, made: number): string {
  return `The PO document was not attached to ${String(missing)} of the ${String(made)} orders.`;
}

export function ordersCreatedUrl(
  quotePath: string,
  notice: string,
  missing?: {
    readonly orderIds: readonly string[];
    readonly made: number;
    readonly refusal: string | undefined;
  },
): string {
  if (missing === undefined || missing.orderIds.length === 0) {
    return noticeUrl(quotePath, notice);
  }
  const lead = documentMissingSentence(missing.orderIds.length, missing.made);
  return noticeUrl(quotePath, notice, {
    error: missing.refusal === undefined ? lead : `${lead} ${missing.refusal}`,
    [PO_MISSING_FIELD]: missing.orderIds.join(','),
  });
}
