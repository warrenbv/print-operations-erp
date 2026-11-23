// The sentences people read when the system refuses a value: the API returns them in its 400 bodies and the web
// forms show them. They are set here once, so every schema in this package words a refusal the same way, and a
// message written on a check or a refinement wins over them. apps/web/src/lib/api-error.ts reads "Required" as a
// missing field. `refusalBody` is the shape of a refused request's body, which the API's controllers return.
import { z } from 'zod';

type Issue = z.core.$ZodRawIssue;

/** The body the API returns for a request its schema refuses: `{ formErrors, fieldErrors }`, keyed by top-level field. */
export function refusalBody<T>(error: z.ZodError<T>): z.core.$ZodFlattenedError<T> {
  return z.flattenError(error);
}

function isThenable(value: object): boolean {
  const { then, catch: onError } = value as { then?: unknown; catch?: unknown };
  return typeof then === 'function' && typeof onError === 'function';
}

// The name a refusal gives to what it received.
function receivedType(value: unknown): string {
  switch (typeof value) {
    case 'number':
      return Number.isNaN(value) ? 'nan' : 'number';
    case 'object':
      if (value === null) return 'null';
      if (Array.isArray(value)) return 'array';
      if (value instanceof Date) return 'date';
      if (value instanceof Map) return 'map';
      if (value instanceof Set) return 'set';
      if (isThenable(value)) return 'promise';
      return 'object';
    default:
      return typeof value;
  }
}

function listed(values: readonly unknown[], separator = ' | '): string {
  return values
    .map((value) => (typeof value === 'string' ? `'${value}'` : String(value)))
    .join(separator);
}

// A literal is a primitive, and a bigint is written as its digits, so this never throws.
function literal(value: unknown): string {
  return String(
    JSON.stringify(value, (_key, part: unknown) =>
      typeof part === 'bigint' ? part.toString() : part,
    ),
  );
}

function isIntegerSchema(issue: Issue): boolean {
  return issue.inst instanceof z.ZodNumber && (issue.inst.format ?? '').includes('int');
}

function tooSmall(origin: string, minimum: number | bigint, exact: boolean, inclusive: boolean) {
  switch (origin) {
    case 'array':
      return `Array must contain ${exact ? 'exactly' : inclusive ? 'at least' : 'more than'} ${minimum} element(s)`;
    case 'string':
      return `String must contain ${exact ? 'exactly' : inclusive ? 'at least' : 'over'} ${minimum} character(s)`;
    case 'number':
    case 'int':
    case 'bigint': {
      const how = exact
        ? 'exactly equal to'
        : inclusive
          ? 'greater than or equal to'
          : 'greater than';
      return `Number must be ${how} ${minimum}`;
    }
    case 'date': {
      const how = exact
        ? 'exactly equal to'
        : inclusive
          ? 'greater than or equal to'
          : 'greater than';
      return `Date must be ${how} ${new Date(Number(minimum)).toString()}`;
    }
    default:
      return 'Invalid input';
  }
}

function tooBig(origin: string, maximum: number | bigint, exact: boolean, inclusive: boolean) {
  switch (origin) {
    case 'array':
      return `Array must contain ${exact ? 'exactly' : inclusive ? 'at most' : 'less than'} ${maximum} element(s)`;
    case 'string':
      return `String must contain ${exact ? 'exactly' : inclusive ? 'at most' : 'under'} ${maximum} character(s)`;
    case 'number':
    case 'int':
      return `Number must be ${exact ? 'exactly' : inclusive ? 'less than or equal to' : 'less than'} ${maximum}`;
    case 'bigint':
      return `BigInt must be ${exact ? 'exactly' : inclusive ? 'less than or equal to' : 'less than'} ${maximum}`;
    case 'date': {
      const how = exact ? 'exactly' : inclusive ? 'smaller than or equal to' : 'smaller than';
      return `Date must be ${how} ${new Date(Number(maximum)).toString()}`;
    }
    default:
      return 'Invalid input';
  }
}

function invalidType(issue: Extract<Issue, { code: 'invalid_type' }>): string {
  const input = issue.input;
  if (input === undefined) return 'Required';
  if (issue.expected === 'int') return 'Expected integer, received float';
  if (
    issue.expected === 'number' &&
    typeof input === 'number' &&
    !Number.isNaN(input) &&
    !Number.isFinite(input)
  ) {
    return isIntegerSchema(issue) ? 'Expected integer, received float' : 'Number must be finite';
  }
  if (issue.expected === 'date' && input instanceof Date) return 'Invalid date';
  return `Expected ${issue.expected}, received ${receivedType(input)}`;
}

function invalidValue(issue: Extract<Issue, { code: 'invalid_value' }>): string {
  const input = issue.input;
  if (issue.inst instanceof z.ZodEnum) {
    if (input === undefined) return 'Required';
    if (typeof input !== 'string')
      return `Expected ${listed(issue.values)}, received ${receivedType(input)}`;
    return `Invalid enum value. Expected ${listed(issue.values)}, received '${input}'`;
  }
  return `Invalid literal value, expected ${literal(issue.values[0])}`;
}

function invalidFormat(issue: Extract<Issue, { code: 'invalid_format' }>): string {
  switch (issue.format) {
    case 'regex':
      return 'Invalid';
    case 'starts_with':
      return `Invalid input: must start with "${String(issue['prefix'])}"`;
    case 'ends_with':
      return `Invalid input: must end with "${String(issue['suffix'])}"`;
    case 'includes': {
      const position = issue['position'];
      const base = `Invalid input: must include "${String(issue['includes'])}"`;
      return typeof position === 'number'
        ? `${base} at one or more positions greater than or equal to ${position}`
        : base;
    }
    case 'guid':
      return 'Invalid uuid';
    default:
      return `Invalid ${issue.format}`;
  }
}

function message(issue: Issue): string {
  switch (issue.code) {
    case 'invalid_type':
      return invalidType(issue);
    case 'invalid_value':
      return invalidValue(issue);
    case 'too_small':
      return tooSmall(issue.origin, issue.minimum, issue.exact === true, issue.inclusive === true);
    case 'too_big':
      return tooBig(issue.origin, issue.maximum, issue.exact === true, issue.inclusive === true);
    case 'invalid_format':
      return invalidFormat(issue);
    case 'invalid_union': {
      const options = issue['options'];
      return Array.isArray(options) && issue['discriminator'] !== undefined
        ? `Invalid discriminator value. Expected ${listed(options)}`
        : 'Invalid input';
    }
    case 'unrecognized_keys':
      return `Unrecognized key(s) in object: ${listed(issue.keys, ', ')}`;
    case 'not_multiple_of':
      return `Number must be a multiple of ${issue.divisor}`;
    default:
      return 'Invalid input';
  }
}

z.config({ customError: message });
