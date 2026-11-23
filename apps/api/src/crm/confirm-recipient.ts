// Refuses a send when the contacts tagged to receive it changed after the page showed them.
// Callers: the quote send and the order confirmation. apps/api/test/every-send-confirms-its-recipient.test.ts finds them by this call.
import { normaliseEmailAddress } from '@erp/types';
import { ConflictException } from '@nestjs/common';

/**
 * Compares the two lists as sets of normalised addresses, so order, case and repeats do not matter.
 * An absent `confirmRecipients` skips the check, which is the wire contract. An empty list is a real answer.
 * Throws 409 `recipient-changed`.
 */
export function assertRecipientConfirmed(
  confirmRecipients: readonly string[] | undefined,
  recipients: readonly string[],
): void {
  if (confirmRecipients === undefined) {
    return;
  }

  const confirmed = foldAddresses(confirmRecipients);
  const current = foldAddresses(recipients);

  if (sameAddressSet(confirmed, current)) {
    return;
  }

  throw new ConflictException({
    reason: 'recipient-changed',
    // Both lists go back, because the person has to decide again on what is there now.
    value: { confirmed: [...confirmed], designated: [...current] },
    message:
      'the contacts tagged to receive this document changed while the page was open, so nothing was sent',
  });
}

function foldAddresses(addresses: readonly string[]): ReadonlySet<string> {
  return new Set(addresses.map(normaliseEmailAddress));
}

function sameAddressSet(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  if (left.size !== right.size) {
    return false;
  }
  for (const address of left) {
    if (!right.has(address)) {
      return false;
    }
  }
  return true;
}
