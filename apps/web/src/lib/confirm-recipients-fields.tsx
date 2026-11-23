// Hidden fields that post the recipient list a send form showed, plus a marker that it showed one.
// The API refuses the send if the tagged contacts changed meanwhile: apps/api/src/crm/confirm-recipient.ts.
// The field names and the body builder are in apps/web/src/lib/confirm-recipients.ts.
import { CONFIRM_RECIPIENTS_FIELD, CONFIRM_RECIPIENTS_SHOWN_FIELD } from './confirm-recipients';

export function ConfirmRecipientsFields({ addresses }: { addresses: readonly string[] }) {
  return (
    <>
      <input type="hidden" name={CONFIRM_RECIPIENTS_SHOWN_FIELD} value="1" />
      {addresses.map((address) => (
        <input key={address} type="hidden" name={CONFIRM_RECIPIENTS_FIELD} value={address} />
      ))}
    </>
  );
}
