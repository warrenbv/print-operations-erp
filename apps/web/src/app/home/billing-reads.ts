// Turns the usernames of the people who asked for price approvals into display names for the Billing Manager's cards.
import { salesRepLabel } from '@erp/types';

import { loadResolvedReps } from '../../lib/sales-reps';
import type { Workbook } from '../../lib/work/load-workbook';

export async function loadRepNames(wb: Workbook): Promise<ReadonlyMap<string, string>> {
  const usernames = [
    ...new Set(
      wb.approvals.flatMap((approval) =>
        approval.kind === 'price-override' && approval.salesRep !== undefined
          ? [approval.salesRep]
          : [],
      ),
    ),
  ];
  const resolved = await loadResolvedReps(usernames);
  return new Map([...resolved].map(([username, rep]) => [username, salesRepLabel(rep)]));
}
