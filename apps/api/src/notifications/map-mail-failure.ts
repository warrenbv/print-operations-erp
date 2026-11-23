// Maps a failed mail submission to 503, telling a permanent refusal from an unreachable relay. Anything else is rethrown.
// `left-quoted` as the value says the quote could not be put back after its move to quoted, so it shows as sent.
import { MailSubmissionError } from '@erp/notifications';
import { ServiceUnavailableException } from '@nestjs/common';

export function mapMailFailure(err: unknown, leftQuoted = false): never {
  if (err instanceof MailSubmissionError) {
    throw new ServiceUnavailableException({
      reason: err.permanent ? 'relay-refused' : 'relay-unreachable',
      ...(leftQuoted ? { value: 'left-quoted' } : {}),

      attempts: err.attempts,
      message:
        (err.permanent
          ? 'the mail relay refused this message, and sending it again will be refused too'
          : 'the mail relay could not be reached, so nothing was sent; try again shortly') +
        (leftQuoted ? '. The quote could not be put back and shows as sent' : ''),
    });
  }
  throw err;
}
