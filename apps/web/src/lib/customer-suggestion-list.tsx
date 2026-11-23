// The datalist behind customer name boxes, and the line saying when it holds only some of the accounts.
// A native datalist needs no client script: docs/decisions/004-server-first-web-ui.md. The data comes from apps/web/src/lib/customer-suggestions.ts.
import type { CustomerName } from '@erp/types';
import { COLOR, FONT_SIZE, SPACE } from '@erp/ui';

import { CUSTOMER_LIST_ID } from './customer-suggestions';

export function CustomerSuggestions({ items }: { items: readonly CustomerName[] }) {
  return (
    <datalist id={CUSTOMER_LIST_ID}>
      {items.map((customer) => (
        <option key={customer.id} value={customer.name}>
          {customer.legacyAccountNumber === undefined
            ? ''
            : `Legacy account #${customer.legacyAccountNumber}`}
        </option>
      ))}
    </datalist>
  );
}

export function SuggestionCoverage({ shown, total }: { shown: number; total: number }) {
  if (shown >= total) {
    return null;
  }
  return (
    <p style={{ color: COLOR.muted, fontSize: FONT_SIZE.sm, margin: `${SPACE.md} 0 0` }}>
      Suggestions cover {shown} of {total} accounts. Searching finds the rest.
    </p>
  );
}
