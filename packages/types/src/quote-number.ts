// The quote number people see and type: a prefix and a zero-padded counter, with the version after a revision.
// The counter comes from `quote_number_seq` in infra/db/migrations/quoting/0000_baseline.sql.
export const QUOTE_NUMBER_PREFIX = 'Q';

const COUNTER_DIGITS = 5;

export function formatQuoteNumber(counter: number): string {
  if (!Number.isInteger(counter) || counter < 1) {
    throw new RangeError(`quote number counter must be a positive integer, got ${counter}`);
  }
  return `${QUOTE_NUMBER_PREFIX}-${String(counter).padStart(COUNTER_DIGITS, '0')}`;
}

export function quoteReference(quote: { quoteNumber: number; versionNumber: number }): string {
  const number = formatQuoteNumber(quote.quoteNumber);
  return quote.versionNumber > 1 ? `${number} v${quote.versionNumber}` : number;
}

// Accepts the number with or without its prefix, with leading zeros, and with a version suffix.
const QUOTE_NUMBER_INPUT = /^(?:q\s*-?\s*)?0*([1-9]\d{0,14})(?:\s*v\d+)?$/i;

export function parseQuoteNumber(text: string): number | undefined {
  const match = QUOTE_NUMBER_INPUT.exec(text.trim());
  if (match === null || match[1] === undefined) return undefined;
  const counter = Number(match[1]);
  return Number.isSafeInteger(counter) ? counter : undefined;
}
