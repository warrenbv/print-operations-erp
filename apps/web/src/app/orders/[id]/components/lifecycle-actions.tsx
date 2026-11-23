// The Confirm the order form and the order confirmation email control.
// Both post to apps/web/src/app/orders/[id]/lifecycle-actions.ts.
import { type OrderWithLines } from '@erp/types';
import {
  ActRow,
  Button,
  ButtonReason,
  COLOR,
  Field,
  FieldLabel,
  Hint,
  Input,
  KV,
  SPACE,
} from '@erp/ui';

import { ConfirmRecipientsFields } from '../../../../lib/confirm-recipients-fields';
import { RECIPIENT_BUTTON_STYLE, recipientListLabel } from '../../../../lib/confirm-recipients';
import { nobodyTagged } from '../../../../lib/helptext';
import { confirmOrderAction, issueOrderConfirmationAction } from '../lifecycle-actions';

export function ConfirmForm({
  order,
  defaultDays,
  hint,
  fieldError,
}: {
  order: Pick<OrderWithLines, 'id' | 'lockVersion' | 'requestedDate'>;

  defaultDays: number | undefined;

  hint: string;
  fieldError: string | undefined;
}) {
  return (
    <form action={confirmOrderAction} style={{ display: 'grid', gap: SPACE.md }}>
      <input type="hidden" name="orderId" value={order.id} />

      <input type="hidden" name="lockVersion" value={order.lockVersion} />

      <KV>
        <dt>Delivery date</dt>
        <dd>{order.requestedDate ?? <span style={{ color: COLOR.muted }}>None given</span>}</dd>
      </KV>

      <Field>
        <FieldLabel>Committed lead time (days)</FieldLabel>

        <Input
          name="confirmedLeadTimeDays"
          type="number"
          min={0}
          max={3650}
          step={1}
          inputMode="numeric"
          required
          defaultValue={defaultDays}
          style={{ width: 120 }}
        />

        <Hint>{hint}</Hint>
        {fieldError !== undefined && <span style={{ color: COLOR.danger }}>{fieldError}</span>}
      </Field>

      <ActRow>
        <Button variant="primary">Confirm the order</Button>
        <ButtonReason>
          Commits the shop, gives the order its job number, and lets Sales email the order
          confirmation.
        </ButtonReason>
      </ActRow>
    </form>
  );
}

export interface SentConfirmation {
  readonly to: string;
  readonly on: string;
}

export function SendConfirmation({
  order,
  recipients,
  sent,
  maySend,
}: {
  order: Pick<OrderWithLines, 'id'>;

  recipients: readonly string[];
  sent: SentConfirmation | null;
  maySend: boolean;
}) {
  if (sent !== null) {
    return (
      <>
        Emailed to {sent.to} on {sent.on}
        {maySend && (
          <details style={{ marginTop: SPACE.sm }}>
            <summary style={{ cursor: 'pointer', color: COLOR.muted }}>Send it again</summary>
            <div style={{ marginTop: SPACE.sm }}>
              <SendForm order={order} recipients={recipients} />
            </div>
          </details>
        )}
      </>
    );
  }
  if (!maySend) return <span style={{ color: COLOR.muted }}>Not sent yet</span>;
  return <SendForm order={order} recipients={recipients} />;
}

function SendForm({
  order,
  recipients,
}: {
  order: Pick<OrderWithLines, 'id'>;
  recipients: readonly string[];
}) {
  if (recipients.length === 0) {
    return (
      <p style={{ color: COLOR.warning, margin: 0, maxWidth: 520 }}>
        {nobodyTagged('order confirmations', 'Order confirmation')}
      </p>
    );
  }
  return (
    <form action={issueOrderConfirmationAction} style={{ display: 'grid', gap: SPACE.sm }}>
      <input type="hidden" name="orderId" value={order.id} />

      <ConfirmRecipientsFields addresses={recipients} />
      <div>
        <Button style={RECIPIENT_BUTTON_STYLE}>
          Email the order confirmation to {recipientListLabel(recipients)}
        </Button>
      </div>

      <Hint>
        The Order Confirmation states the price, the terms and the lead time. Sending again is safe;
        each send files a fresh copy.
      </Hint>
    </form>
  );
}
