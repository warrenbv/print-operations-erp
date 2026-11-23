// SQLSTATE codes and predicates that let a PostgreSQL adapter turn a constraint violation into a
// domain error, for example modules/crm/src/adapters/drizzle/drizzle-customer-repository.ts.
export const UNIQUE_VIOLATION = '23505';

export const FOREIGN_KEY_VIOLATION = '23503';

export const CHECK_VIOLATION = '23514';

export const NOT_NULL_VIOLATION = '23502';

const MAX_CAUSE_DEPTH = 5;

/**
 * The SQLSTATE of a driver error, or `undefined`. Drizzle wraps the driver error, so the code can sit
 * on a `cause` one or more levels down. The walk is bounded, so a cyclic or very deep chain answers
 * `undefined` instead of looping.
 */
export function pgErrorCode(err: unknown): string | undefined {
  let current: unknown = err;
  for (let depth = 0; depth < MAX_CAUSE_DEPTH; depth += 1) {
    if (typeof current !== 'object' || current === null) {
      return undefined;
    }
    const code = (current as { code?: unknown }).code;
    if (typeof code === 'string') {
      return code;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

export function isPgErrorCode(err: unknown, code: string): boolean {
  return pgErrorCode(err) === code;
}

export function isUniqueViolation(err: unknown): boolean {
  return pgErrorCode(err) === UNIQUE_VIOLATION;
}

export function isForeignKeyViolation(err: unknown): boolean {
  return pgErrorCode(err) === FOREIGN_KEY_VIOLATION;
}
