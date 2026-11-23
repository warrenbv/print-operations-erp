// Addresses as one line of text, for table cells and summaries.
// Each quote line carries a delivery address: docs/product/requirements.md (R4).
// The line order comes from `addressLines` in packages/types/src/postal-address.ts, re-exported here.
import { addressLines, type PostalAddress } from '@erp/types';

export { addressLines } from '@erp/types';

export const NO_DELIVERY_DESTINATION = 'no delivery destination, quoted for collection';

export function addressText(address: PostalAddress): string {
  return addressLines(address).join(', ');
}
