// The forms for the customer's PO, its number and its document: docs/product/requirements.md (R9).
// The file box is answered over the body limit by apps/web/src/middleware.ts:
// apps/web/src/app/every-file-box-is-answered-over-50mb.test.ts.
import { type OrderWithLines } from '@erp/types';
import { Button, COLOR, FONT_SIZE, Field, FieldLabel, Hint, Input } from '@erp/ui';

import { ATTACHING_ADDS_A_FILE, RECEIVED_DOCUMENT_HINT } from '../../../../lib/helptext';
import { capturePurchaseOrderAction, uploadPurchaseOrderDocumentAction } from '../actions';

export function PurchaseOrderForm({ order }: { order: OrderWithLines }) {
  return (
    <form
      action={capturePurchaseOrderAction}
      style={{ display: 'grid', gap: '0.6rem', marginTop: '0.75rem' }}
    >
      <input type="hidden" name="orderId" value={order.id} />

      <input type="hidden" name="lockVersion" value={order.lockVersion} />

      <Field>
        <FieldLabel>PO number</FieldLabel>
        <input
          type="text"
          name="poNumber"
          maxLength={64}
          defaultValue={order.poNumber ?? ''}
          style={{ maxWidth: 260 }}
        />
        <Hint>
          As the customer wrote it, or a note such as approved by customer. Leave it blank to clear
          it.
        </Hint>
      </Field>

      <div>
        <Button>Save PO number</Button>
      </div>
    </form>
  );
}

export function AttachDocumentForm({
  order,
  error,
}: {
  order: OrderWithLines;
  error?: string | undefined;
}) {
  return (
    <form action={uploadPurchaseOrderDocumentAction} style={{ display: 'grid', gap: '0.4rem' }}>
      <input type="hidden" name="orderId" value={order.id} />
      <Field>
        <FieldLabel>Attach the PO document</FieldLabel>
        <Input type="file" name="file" />

        <Hint>{RECEIVED_DOCUMENT_HINT}</Hint>
        {error !== undefined && (
          <span style={{ fontSize: FONT_SIZE.xs, color: COLOR.danger }}>{error}</span>
        )}
      </Field>
      <div>
        <Button>Attach</Button>

        <div>
          <Hint>{ATTACHING_ADDS_A_FILE}</Hint>
        </div>
      </div>
    </form>
  );
}
