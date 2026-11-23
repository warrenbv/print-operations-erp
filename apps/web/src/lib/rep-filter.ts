// The sales rep filter on list pages: reading it from the query, its options, and the default for the reader.
// The options and the rep lookups come from apps/web/src/lib/sales-reps.ts.
import type { ResolvedSalesRep, SalesRep } from '@erp/types';

import { repOptions } from './sales-reps';

export const REP_FILTER_ANY = '';

export const REP_FILTER_ANY_LABEL = 'All reps';

export const NO_REP = 'no rep';

export function parseRepFilter(raw: string | undefined): string | undefined {
  if (raw === undefined) {
    return undefined;
  }
  const trimmed = raw.trim();
  return trimmed === '' ? undefined : trimmed;
}

export function repFilterOptions(
  offerable: readonly SalesRep[],
  selected: ResolvedSalesRep | undefined,
): readonly { value: string; label: string }[] {
  return [
    { value: REP_FILTER_ANY, label: REP_FILTER_ANY_LABEL },
    ...repOptions(offerable, selected),
  ];
}

export function defaultRep(
  me: { readonly username: string },
  offerable: readonly SalesRep[],
): string | undefined {
  return offerable.some((rep) => rep.username === me.username) ? me.username : undefined;
}
