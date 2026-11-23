// The rare acts at the foot of the order page: recording or correcting the PO number.
import { type OrderWithLines } from '@erp/types';
import { Fold, FoldGroup, RareActs } from '@erp/ui';

import { PurchaseOrderForm } from './purchase-order';

export function RarelyNeeded({ order }: { order: OrderWithLines }) {
  return (
    <RareActs>
      <FoldGroup>
        <Fold
          summary={order.poNumber === undefined ? 'Record the PO number' : 'Correct the PO number'}
        >
          <PurchaseOrderForm order={order} />
        </Fold>
      </FoldGroup>
    </RareActs>
  );
}
