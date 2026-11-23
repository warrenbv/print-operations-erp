// Where a form may send the reader after it saves, such as back to New quote after adding a customer.
// Only paths on RETURN_TARGETS are honoured, so a crafted link cannot redirect anywhere else.
import { safeReturnPath } from './api-outage';

export const RETURN_TO_FIELD = 'returnTo';

export const NEW_QUOTE_RETURN = '/quoting/quotes/new';

export const RETURN_TARGETS = [NEW_QUOTE_RETURN] as const;

export type ReturnTarget = (typeof RETURN_TARGETS)[number];

export function resolveReturnTo(value: string | undefined): ReturnTarget | undefined {
  const path = pathOf(safeReturnPath(value));
  return RETURN_TARGETS.find((target) => target === path);
}

function pathOf(value: string): string {
  const cut = value.search(/[?#]/);
  return cut === -1 ? value : value.slice(0, cut);
}
