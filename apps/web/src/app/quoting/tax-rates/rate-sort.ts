// Sort order of the Tax rates table, read from the `sort` query parameter.
// An unknown sort falls back to the default and the page says so.
import { calendarDaysBetween, toDecimal, type TaxRateSummary } from '@erp/types';

import { resolveGrouping } from '../../../lib/grouping';

type Compare = (a: TaxRateSummary, b: TaxRateSummary) => number;

interface SortColumnSpec {
  label: string;

  ascending: string;
  descending: string;
  compare: Compare;

  alwaysLast?: (row: TaxRateSummary) => boolean;
}

export const TAX_RATE_SORT_COLUMNS = [
  'jurisdiction',
  'name',
  'rate',
  'effective',
  'source',
  'standing',
] as const;

type TaxRateSortColumn = (typeof TAX_RATE_SORT_COLUMNS)[number];

type SortDirection = 'asc' | 'desc';

const DEFAULT_COLUMN: TaxRateSortColumn = 'name';

const DESC_SUFFIX = '-desc';

const SPECS: Record<TaxRateSortColumn, SortColumnSpec> = {
  jurisdiction: {
    label: 'Jurisdiction',
    ascending: 'A to Z',
    descending: 'Z to A',
    compare: (a, b) => a.jurisdiction.localeCompare(b.jurisdiction),
  },
  name: {
    label: 'Name',
    ascending: 'A to Z',
    descending: 'Z to A',
    compare: (a, b) => (a.name ?? '').localeCompare(b.name ?? ''),

    alwaysLast: (row) => row.name === undefined,
  },
  rate: {
    label: 'Rate',
    ascending: 'lowest first',
    descending: 'highest first',

    compare: (a, b) => toDecimal(a.rate).cmp(b.rate),
  },
  effective: {
    label: 'Effective from',
    ascending: 'earliest first',
    descending: 'latest first',

    compare: (a, b) => calendarDaysBetween(b.effectiveFrom, a.effectiveFrom),
  },
  source: {
    label: 'Source',
    ascending: 'A to Z',
    descending: 'Z to A',
    compare: (a, b) => a.source.localeCompare(b.source),
  },
  standing: {
    label: 'Standing',
    ascending: 'stale first',
    descending: 'current first',

    compare: (a, b) => (a.stale === b.stale ? 0 : a.stale ? -1 : 1),
  },
};

export type TaxRateSortToken = TaxRateSortColumn | `${TaxRateSortColumn}${typeof DESC_SUFFIX}`;

export const TAX_RATE_SORT_TOKENS: readonly TaxRateSortToken[] = TAX_RATE_SORT_COLUMNS.flatMap(
  (column): readonly TaxRateSortToken[] => [column, `${column}${DESC_SUFFIX}`],
);

export interface TaxRateSort {
  column: TaxRateSortColumn;
  direction: SortDirection;

  rejected?: string;
}

export function resolveTaxRateSort(value: string | undefined): TaxRateSort {
  const resolved = resolveGrouping<TaxRateSortToken>(value, TAX_RATE_SORT_TOKENS, DEFAULT_COLUMN);
  const { column, direction } = splitToken(resolved.groupBy);
  return resolved.rejected === undefined
    ? { column, direction }
    : { column, direction, rejected: resolved.rejected };
}

function splitToken(token: TaxRateSortToken): {
  column: TaxRateSortColumn;
  direction: SortDirection;
} {
  const descending = token.endsWith(DESC_SUFFIX);
  const name = descending ? token.slice(0, -DESC_SUFFIX.length) : token;
  const column = TAX_RATE_SORT_COLUMNS.find((candidate) => candidate === name) ?? DEFAULT_COLUMN;
  return { column, direction: descending ? 'desc' : 'asc' };
}

export function sortTaxRates(
  rows: readonly TaxRateSummary[],
  sort: TaxRateSort,
): readonly TaxRateSummary[] {
  const spec = SPECS[sort.column];
  const reverse = sort.direction === 'desc' ? -1 : 1;
  return [...rows].sort((a, b) => {
    const aLast = spec.alwaysLast?.(a) ?? false;
    const bLast = spec.alwaysLast?.(b) ?? false;
    if (aLast !== bLast) return aLast ? 1 : -1;
    return spec.compare(a, b) * reverse || a.jurisdiction.localeCompare(b.jurisdiction);
  });
}

export interface SortHeader {
  column: TaxRateSortColumn;
  label: string;
  href: string;

  direction?: SortDirection;
}

export function sortHeaders(basePath: string, sort: TaxRateSort): readonly SortHeader[] {
  return TAX_RATE_SORT_COLUMNS.map((column) => {
    const active = column === sort.column;
    const next: TaxRateSortToken =
      active && sort.direction === 'asc' ? `${column}${DESC_SUFFIX}` : column;
    return {
      column,
      label: SPECS[column].label,
      href: `${basePath}?sort=${next}`,
      ...(active ? { direction: sort.direction } : {}),
    };
  });
}

export function sortSentence(sort: TaxRateSort): string {
  const spec = SPECS[sort.column];
  const how = `${spec.label}, ${sort.direction === 'asc' ? spec.ascending : spec.descending}`;
  return sort.rejected === undefined
    ? `Sorted by ${how}.`
    : `There is no sort called "${sort.rejected}", so the table is sorted by ${how}.`;
}
