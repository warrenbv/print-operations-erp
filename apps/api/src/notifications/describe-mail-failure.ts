// Reduces a mail failure to what the send log keeps: the chain of messages and whether a retry could work.
// The whole cause chain is read because the relay's own reply sits several wrappers deep.
import { MailSubmissionError } from '@erp/notifications';
import { SEND_FAILURE_DETAIL_MAX } from '@erp/types';

export function describeMailFailure(cause: unknown): {
  failureDetail?: string;
  failurePermanent?: boolean;
} {
  const detail = truncate(chainMessages(cause).join(': '));
  const permanent = cause instanceof MailSubmissionError ? cause.permanent : undefined;

  return {
    ...(detail === undefined ? {} : { failureDetail: detail }),
    ...(permanent === undefined ? {} : { failurePermanent: permanent }),
  };
}

// The depth limit and the seen-set stop a cyclic or endless cause chain.
const MAX_CAUSE_DEPTH = 6;

function chainMessages(cause: unknown): string[] {
  const messages: string[] = [];
  const seen = new Set<unknown>();
  let current: unknown = cause;

  for (
    let depth = 0;
    depth < MAX_CAUSE_DEPTH && current !== undefined && current !== null;
    depth++
  ) {
    if (seen.has(current)) break;
    seen.add(current);

    const message = current instanceof Error ? current.message : String(current);
    const trimmed = message.trim();
    if (trimmed !== '' && !messages.includes(trimmed)) {
      messages.push(trimmed);
    }

    current = current instanceof Error ? current.cause : undefined;
  }
  return messages;
}

function truncate(detail: string): string | undefined {
  if (detail === '') return undefined;
  return detail.length <= SEND_FAILURE_DETAIL_MAX
    ? detail
    : `${detail.slice(0, SEND_FAILURE_DETAIL_MAX - 3)}...`;
}
