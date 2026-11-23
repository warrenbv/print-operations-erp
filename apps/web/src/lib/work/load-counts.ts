// The counts beside the nav menu items for the reader's group. A failed read shows bare labels instead of failing the layout.
// The menu itself is apps/web/src/app/nav/nav-map.ts.
import { orderCountResponseSchema, quoteCountResponseSchema, type SessionUser } from '@erp/types';

import { LEAD_TIMES_HREF, ORDERS_HREF, QUOTES_HREF, type NavCounts } from '../../app/nav/nav-map';
import { fetchParsed } from '../fetch-parsed';
import { loadWorkbook, type Workbook } from './load-workbook';

export function quotesCount(wb: Pick<Workbook, 'quotes'>): number {
  return wb.quotes.filter((entry) => entry.work.group === 'yours').length;
}

export function salesCounts(wb: Pick<Workbook, 'quotes'>): NavCounts {
  return { [QUOTES_HREF]: quotesCount(wb) };
}

export function productionCounts(answers: {
  toConfirm: number;
  leadTimeDraft: number;
  leadTimeOverride: number;
}): NavCounts {
  return {
    [ORDERS_HREF]: answers.toConfirm,
    [LEAD_TIMES_HREF]: answers.leadTimeDraft + answers.leadTimeOverride,
  };
}

// A lead time can be entered while a quote is draft or waiting on an override decision
// (modules/quoting/src/quote-state-machine.ts), so both statuses count toward the lead-time queue.
async function readProduction(): Promise<NavCounts> {
  const [toConfirm, leadTimeDraft, leadTimeOverride] = await Promise.all([
    fetchParsed('/orders?status=converted&count=true', orderCountResponseSchema),
    fetchParsed(
      '/quoting/quotes?status=draft&leadTime=missing&count=true',
      quoteCountResponseSchema,
    ),
    fetchParsed(
      '/quoting/quotes?status=override_requested&leadTime=missing&count=true',
      quoteCountResponseSchema,
    ),
  ]);
  return productionCounts({
    toConfirm: toConfirm.count,
    leadTimeDraft: leadTimeDraft.count,
    leadTimeOverride: leadTimeOverride.count,
  });
}

export async function loadNavCounts(
  me: SessionUser,
  groupId: string | undefined,
): Promise<NavCounts> {
  try {
    switch (groupId) {
      case 'sales':
        return salesCounts(await loadWorkbook(me));
      case 'production':
        return await readProduction();
      default:
        return {};
    }
  } catch (cause) {
    console.warn(`nav counts for ${String(groupId)} failed; bare labels shown:`, cause);
    return {};
  }
}
