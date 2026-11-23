// The job number an order receives at confirmation: the prefix, a hyphen and the counter padded to
// five digits. The counter comes from `OrderRepository.mintJobNumber`.
export const JOB_NUMBER_PREFIX = 'DPW';

const COUNTER_DIGITS = 5;

export function formatJobNumber(counter: number, prefix = JOB_NUMBER_PREFIX): string {
  if (!Number.isInteger(counter) || counter < 1) {
    throw new RangeError(`job number counter must be a positive integer, got ${counter}`);
  }
  return `${prefix}-${String(counter).padStart(COUNTER_DIGITS, '0')}`;
}
