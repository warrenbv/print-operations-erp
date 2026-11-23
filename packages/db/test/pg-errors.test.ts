// How `pgErrorCode` finds a SQLSTATE through wrapped errors, and where it stops looking.
import { describe, expect, it } from 'vitest';

import {
  FOREIGN_KEY_VIOLATION,
  UNIQUE_VIOLATION,
  isForeignKeyViolation,
  isPgErrorCode,
  isUniqueViolation,
  pgErrorCode,
} from '../src/pg-errors';

class WrappedQueryError extends Error {
  override readonly cause: unknown;
  constructor(cause: unknown) {
    super('Failed query: insert into "crm"."customers" ...');
    this.cause = cause;
  }
}

function driverError(code: string): Error & { code: string } {
  return Object.assign(new Error('duplicate key value violates unique constraint'), { code });
}

describe('pgErrorCode', () => {
  it('reads the code off a bare driver error', () => {
    expect(pgErrorCode(driverError(UNIQUE_VIOLATION))).toBe(UNIQUE_VIOLATION);
  });

  it('unwraps a drizzle-style wrapper', () => {
    expect(pgErrorCode(new WrappedQueryError(driverError(UNIQUE_VIOLATION)))).toBe(
      UNIQUE_VIOLATION,
    );
  });

  it('unwraps more than one layer', () => {
    const nested = new WrappedQueryError(new WrappedQueryError(driverError(FOREIGN_KEY_VIOLATION)));
    expect(pgErrorCode(nested)).toBe(FOREIGN_KEY_VIOLATION);
  });

  it('returns undefined for errors that carry no code', () => {
    expect(pgErrorCode(new Error('boom'))).toBeUndefined();
    expect(pgErrorCode(new WrappedQueryError(new Error('boom')))).toBeUndefined();
  });

  it('returns undefined for non-objects rather than throwing', () => {
    for (const value of [null, undefined, 'nope', 42, true]) {
      expect(pgErrorCode(value)).toBeUndefined();
    }
  });

  it('ignores a non-string code', () => {
    expect(pgErrorCode(Object.assign(new Error('x'), { code: 23505 }))).toBeUndefined();
  });

  it('terminates on a self-referential cause chain', () => {
    const cyclic: { cause?: unknown } = {};
    cyclic.cause = cyclic;
    expect(pgErrorCode(cyclic)).toBeUndefined();
  });

  it('gives up past the depth bound instead of walking forever', () => {
    let deep: unknown = driverError(UNIQUE_VIOLATION);
    for (let i = 0; i < 10; i += 1) {
      deep = new WrappedQueryError(deep);
    }
    expect(pgErrorCode(deep)).toBeUndefined();
  });
});

describe('the named predicates', () => {
  it('match through the wrapper', () => {
    expect(isUniqueViolation(new WrappedQueryError(driverError(UNIQUE_VIOLATION)))).toBe(true);
    expect(isForeignKeyViolation(new WrappedQueryError(driverError(FOREIGN_KEY_VIOLATION)))).toBe(
      true,
    );
  });

  it('do not confuse one SQLSTATE for another', () => {
    expect(isUniqueViolation(driverError(FOREIGN_KEY_VIOLATION))).toBe(false);
    expect(isForeignKeyViolation(driverError(UNIQUE_VIOLATION))).toBe(false);
    expect(isPgErrorCode(driverError('23514'), '23514')).toBe(true);
  });
});
