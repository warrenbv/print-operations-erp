// Loads the reps a record may be assigned to, and resolves stored usernames to names for display.
// A stored rep who is no longer offered still shows and stays an option, so editing a record does not reassign it silently.
import {
  resolvedSalesRepListResponseSchema,
  salesRepListResponseSchema,
  SALES_REP_RESOLVE_MAX_NAMES,
  type ResolvedSalesRep,
  type SalesRep,
} from '@erp/types';

import { fetchParsed } from './fetch-parsed';

export async function loadSalesReps(): Promise<readonly SalesRep[]> {
  const { items } = await fetchParsed('/sales-reps', salesRepListResponseSchema);
  return items;
}

export async function loadResolvedReps(
  usernames: readonly string[],
): Promise<ReadonlyMap<string, ResolvedSalesRep>> {
  const pages = await Promise.all(
    resolveBatches(usernames).map((batch) =>
      fetchParsed(
        `/sales-reps/resolve?usernames=${encodeURIComponent(batch.join(','))}`,
        resolvedSalesRepListResponseSchema,
      ),
    ),
  );
  return new Map(pages.flatMap((page) => page.items.map((item) => [item.username, item] as const)));
}

// The API resolves at most SALES_REP_RESOLVE_MAX_NAMES per request (packages/types/src/sales-rep.ts).
export function resolveBatches(usernames: readonly string[]): readonly string[][] {
  const wanted = [...new Set(usernames)];
  const batches: string[][] = [];
  for (let i = 0; i < wanted.length; i += SALES_REP_RESOLVE_MAX_NAMES) {
    batches.push(wanted.slice(i, i + SALES_REP_RESOLVE_MAX_NAMES));
  }
  return batches;
}

export async function loadResolvedRep(
  username: string | undefined,
): Promise<ResolvedSalesRep | undefined> {
  if (username === undefined) {
    return undefined;
  }
  const resolved = await loadResolvedReps([username]);

  return resolved.get(username) ?? { username, offerable: false };
}

export function resolveFromOfferable(
  username: string,
  offerable: readonly SalesRep[],
): ResolvedSalesRep {
  const found = offerable.find((rep) => rep.username === username);
  return found === undefined
    ? { username, offerable: false }
    : { username, displayName: found.displayName, offerable: true };
}

export function repOptions(
  offerable: readonly SalesRep[],
  stored: ResolvedSalesRep | undefined,
): readonly { value: string; label: string }[] {
  const options = offerable.map((rep) => ({ value: rep.username, label: rep.displayName }));
  if (stored === undefined || stored.offerable) {
    return options;
  }

  return [
    ...options,
    {
      value: stored.username,
      label:
        stored.displayName === undefined
          ? `${stored.username} (as stored)`
          : `${stored.displayName} (no longer in sales)`,
    },
  ];
}
