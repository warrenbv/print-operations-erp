// Where a quote action returns to, and the notice shown once the quote is sent.
import { formatTimestamp } from '../../../../../lib/dates';

export const FROM_REVIEW = 'review';

export function returnPath(quoteId: string, from: FormDataEntryValue | null): string {
  const quote = `/quoting/quotes/${encodeURIComponent(quoteId)}`;
  return from === FROM_REVIEW ? `${quote}/review` : quote;
}

export function sentNotice(addresses: readonly string[], acceptedAt: string | undefined): string {
  const to = addresses.length === 0 ? 'the customer' : addresses.join(', ');
  return acceptedAt === undefined
    ? `Quote sent to ${to}.`
    : `Quote sent to ${to} at ${formatTimestamp(acceptedAt)}.`;
}
