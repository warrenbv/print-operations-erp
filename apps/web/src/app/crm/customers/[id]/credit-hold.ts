// The credit hold control on a customer page: which act its button offers, and how its form is read.
import { setCreditHoldRequestSchema, type SetCreditHoldRequest } from '@erp/types';

export type Collected<T> =
  { ok: true; customerId: string; request: T } | { ok: false; message: string };

export function creditHoldAct(held: boolean): { nextHeld: boolean; label: string } {
  return held
    ? { nextHeld: false, label: 'Lift hold' }
    : { nextHeld: true, label: 'Place on hold' };
}

export function collectSetCreditHold(formData: FormData): Collected<SetCreditHoldRequest> {
  const customerId = formData.get('customerId');
  if (typeof customerId !== 'string' || customerId === '') {
    return { ok: false, message: 'That form did not say which customer.' };
  }

  const held = formData.get('held');
  if (held !== 'true' && held !== 'false') {
    return { ok: false, message: 'That form did not say whether to place or lift the hold.' };
  }

  const parsed = setCreditHoldRequestSchema.safeParse({
    held: held === 'true',
    lockVersion: Number(formData.get('lockVersion')),
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue === undefined ? '' : issue.path.join('.');
    const message = issue === undefined ? 'That form was malformed.' : issue.message;
    return { ok: false, message: path === '' ? message : `${path}: ${message}` };
  }

  return { ok: true, customerId, request: parsed.data };
}
