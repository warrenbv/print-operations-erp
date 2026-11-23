// The error behind optimistic concurrency: docs/decisions/006-optimistic-concurrency.md.
// It lives in a shared package so module adapters can throw it and the API can catch it without a
// module-to-module import. The API maps it to HTTP 409, for example in apps/api/src/orders/orders.controller.ts.
/**
 * Thrown by a repository when the caller's `lockVersion` does not match the stored one. The person
 * must re-read and resubmit, because the figures they decided on have changed. `expected` and
 * `actual` are for diagnosis only. Nothing should branch on their values.
 */
export class StaleAggregateError extends Error {
  readonly aggregate: string;
  readonly id: string;
  readonly expected: number;
  readonly actual: number;

  constructor(aggregate: string, id: string, expected: number, actual: number) {
    super(`${aggregate} ${id} has moved on — expected lockVersion ${expected}, found ${actual}`);
    this.name = 'StaleAggregateError';
    this.aggregate = aggregate;
    this.id = id;
    this.expected = expected;
    this.actual = actual;
  }
}
