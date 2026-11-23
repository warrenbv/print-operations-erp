// Reads a group-by choice from the query string. An unknown value falls back to the default and is reported as `rejected`,
// so the page can say the link was not understood. Used by apps/web/src/app/quoting/tax-rates/rate-sort.ts.
export interface ReportGrouping<T extends string> {
  groupBy: T;

  rejected?: string;
}

export function resolveGrouping<T extends string>(
  value: string | undefined,
  allowed: readonly T[],
  fallback: T,
): ReportGrouping<T> {
  if (value === undefined) return { groupBy: fallback };
  const match = allowed.find((option) => option === value);
  if (match === undefined) return { groupBy: fallback, rejected: value };
  return { groupBy: match };
}
