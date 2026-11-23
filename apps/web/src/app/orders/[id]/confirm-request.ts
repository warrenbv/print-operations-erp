// Reads the Confirm the order form. The committed lead time is a whole number of calendar days,
// and zero is allowed: docs/product/requirements.md (R11).
// Any other parse failure means the page's `lockVersion` is unusable, and the message asks for a reload.
import { confirmOrderRequestSchema, type ConfirmOrderRequest } from '@erp/types';

export interface ConfirmFormValues {
  readonly confirmedLeadTimeDays: string;

  readonly lockVersion: string;
}

export type ConfirmFormOutcome =
  | { readonly ok: true; readonly request: ConfirmOrderRequest }
  | { readonly ok: false; readonly message: string; readonly field?: string };

const LEAD_TIME_GLOSS =
  'Enter the committed lead time in whole days. Zero is allowed - same-day work is a real commitment.';

export function toConfirmRequest(values: ConfirmFormValues): ConfirmFormOutcome {
  const raw = values.confirmedLeadTimeDays.trim();
  if (raw === '') {
    return { ok: false, message: LEAD_TIME_GLOSS, field: 'confirmedLeadTimeDays' };
  }

  const parsed = confirmOrderRequestSchema.safeParse({
    confirmedLeadTimeDays: Number(raw),
    lockVersion: Number(values.lockVersion.trim()),
  });
  if (parsed.success) {
    return { ok: true, request: parsed.data };
  }

  const issue = parsed.error.issues[0];
  const field = typeof issue?.path[0] === 'string' ? issue.path[0] : undefined;
  if (field === 'confirmedLeadTimeDays') {
    return { ok: false, message: LEAD_TIME_GLOSS, field };
  }
  return {
    ok: false,
    message: 'This page is out of date. Reload the order and confirm it again.',
  };
}
