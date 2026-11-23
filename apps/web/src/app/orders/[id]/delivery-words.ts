// Words for a line's estimated freight. Freight that waits on a carrier bid is marked as not yet known:
// docs/product/requirements.md (R4).
import { formatMoney, freightKnowledge, type FreightResult } from '@erp/types';

import { SHIPPING_MODE_LABELS } from '../../quoting/format';

export interface EstimatedFreightWords {
  readonly mode: string;

  readonly amount?: string;

  readonly tbd?: string;
}

export function estimatedFreightWords(result: FreightResult): EstimatedFreightWords {
  const mode = SHIPPING_MODE_LABELS[result.mode];
  switch (freightKnowledge(result)) {
    case 'unknown':
      return { mode, tbd: 'freight TBD' };
    case 'partial':
      return { mode, amount: formatMoney(result.invoiceTotal), tbd: '+ last leg TBD' };
    case 'known':
      return { mode, amount: formatMoney(result.invoiceTotal) };
  }
}
