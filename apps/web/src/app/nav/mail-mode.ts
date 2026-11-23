// The sentence the top bar shows when the API diverts outgoing email for testing.
// A null diversion means mail goes out as addressed, and nothing is shown.
import type { MailRedirectView } from '@erp/types';

export function mailModeSentence(redirect: MailRedirectView | null): string | undefined {
  if (redirect === null) {
    return undefined;
  }
  if (redirect.allow.length === 0) {
    return `Test mode: every email goes to ${redirect.to}.`;
  }
  return (
    `Test mode: customer email goes to ${redirect.to}. ` +
    `Real email reaches only ${redirect.allow.join(', ')}.`
  );
}
