// Reads whether outgoing mail is redirected while testing, for the notice the layout and the review page show.
// A failed read shows no notice instead of failing the page. The shape is packages/types/src/mail-mode.ts.
import { mailModeResponseSchema, type MailRedirectView } from '@erp/types';

import { apiFetch } from './api-fetch';

export async function loadMailRedirect(): Promise<MailRedirectView | null> {
  try {
    const response = await apiFetch('/notifications/mail-mode');
    if (!response.ok) {
      console.warn(`mail-mode read answered ${String(response.status)}; no test-mode notice shown`);
      return null;
    }
    return mailModeResponseSchema.parse(await response.json()).redirect;
  } catch (cause) {
    console.warn('mail-mode read failed; no test-mode notice shown:', cause);
    return null;
  }
}
