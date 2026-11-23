// Page and page size from the query string, the line that says which rows show, and the links between pages.
// A missing or malformed number falls back to the default instead of refusing the page.
// The size is capped at the API's search limit from packages/types/src/customer.ts.
import { CUSTOMER_SEARCH_DEFAULT_LIMIT, CUSTOMER_SEARCH_MAX_LIMIT } from '@erp/types';

export const DEFAULT_PAGE_SIZE = CUSTOMER_SEARCH_DEFAULT_LIMIT;

export const MAX_PAGE_SIZE = CUSTOMER_SEARCH_MAX_LIMIT;

export interface Paging {
  page: number;

  size: number;

  offset: number;
}

function counted(value: string | undefined): number | undefined {
  if (value === undefined || !/^\d+$/.test(value.trim())) return undefined;
  const parsed = Number(value.trim());
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

export function resolvePaging(
  params: { page?: string; size?: string },
  defaultSize: number = DEFAULT_PAGE_SIZE,
): Paging {
  const page = counted(params.page) ?? 1;
  const asked = counted(params.size) ?? defaultSize;
  const size = Math.min(asked, MAX_PAGE_SIZE);
  return { page, size, offset: (page - 1) * size };
}

export function showingLine(paging: Paging, total: number, count: number): string | null {
  if (total === 0) return null;
  if (count === 0) {
    return `No rows on page ${String(paging.page)}. ${String(total)} in total.`;
  }
  const first = paging.offset + 1;
  return `Showing ${String(first)} to ${String(paging.offset + count)} of ${String(total)}.`;
}

export function hasPreviousPage(paging: Paging): boolean {
  return paging.page > 1;
}

export function hasNextPage(paging: Paging, total: number): boolean {
  return paging.offset + paging.size < total;
}

export function pageHref(
  path: string,
  params: Readonly<Record<string, string | undefined>>,
  page: number,
  pageKey: string = DEFAULT_PAGE_KEY,
): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') query.set(key, value);
  }

  if (page > 1) query.set(pageKey, String(page));
  const search = query.toString();
  return search === '' ? path : `${path}?${search}`;
}

export const DEFAULT_PAGE_KEY = 'page';
