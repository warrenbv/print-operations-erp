// Tests for the wording of validation refusals: packages/types/src/validation-messages.ts.
// Each case parses through a schema the package exports, loaded from the package entry, and pins the exact sentence.
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  CONTACT_NEEDS_NAME_OR_EMAIL,
  ROLL_WIDTH_REFUSAL,
  contactRoleSchema,
  createContactRequestSchema,
  createCustomerRequestSchema,
  createOrdersRequestSchema,
  documentSubjectSchema,
  freightInputSchema,
  healthPayloadSchema,
  paymentTermsSchema,
  postalAddressSchema,
  refusalBody,
  rollWidthSchema,
  setRolesRequestSchema,
  taxRateSummaryListResponseSchema,
  updateContactRequestSchema,
} from '../src';

type Parser = {
  safeParse(
    input: unknown,
  ):
    | { success: true }
    | { success: false; error: { issues: { path: PropertyKey[]; message: string }[] } };
};

/** The messages a refusal carries at one path, in order. */
function messagesAt(schema: Parser, input: unknown, path: string): string[] {
  const result = schema.safeParse(input);
  if (result.success) throw new Error('expected a refusal');
  return result.error.issues
    .filter((issue) => issue.path.join('.') === path)
    .map((issue) => issue.message);
}

const UUID = '3f2b8c1e-4a6d-4f1b-9c2e-7d5a1b3c9e0f';
const HEALTH = {
  status: 'ok',
  service: 'api',
  version: '1',
  uptimeSeconds: 1,
  timestamp: '2027-01-04T09:30:00.000Z',
};
const IDENTITY = { externalId: 'x1', username: 'pat', displayName: 'Pat' };

describe('the wording of a refusal', () => {
  it('names a missing field as Required', () => {
    expect(messagesAt(createCustomerRequestSchema, {}, 'name')).toEqual(['Required']);
  });

  it('names the expected and the received type', () => {
    expect(messagesAt(createCustomerRequestSchema, { name: 5 }, 'name')).toEqual([
      'Expected string, received number',
    ]);
    expect(messagesAt(createCustomerRequestSchema, { name: null }, 'name')).toEqual([
      'Expected string, received null',
    ]);
  });

  it('counts the characters of a string that is too short or too long', () => {
    const tooShort = { name: 'Acme', legacyAccountNumber: '' };
    const tooLong = { name: 'Acme', legacyAccountNumber: 'x'.repeat(65) };
    expect(messagesAt(createCustomerRequestSchema, tooShort, 'legacyAccountNumber')).toEqual([
      'String must contain at least 1 character(s)',
    ]);
    expect(messagesAt(createCustomerRequestSchema, tooLong, 'legacyAccountNumber')).toEqual([
      'String must contain at most 64 character(s)',
    ]);
  });

  it('states the bound of a number that is too small or too big', () => {
    expect(messagesAt(paymentTermsSchema, { netDays: 0 }, 'netDays')).toEqual([
      'Number must be greater than 0',
    ]);
    expect(messagesAt(paymentTermsSchema, { netDays: 366 }, 'netDays')).toEqual([
      'Number must be less than or equal to 365',
    ]);
    expect(messagesAt(updateContactRequestSchema, { lockVersion: 0 }, 'lockVersion')).toEqual([
      'Number must be greater than or equal to 1',
    ]);
  });

  it('refuses a fraction where a whole number is required', () => {
    expect(messagesAt(paymentTermsSchema, { netDays: 1.5 }, 'netDays')).toEqual([
      'Expected integer, received float',
    ]);
  });

  it('refuses a whole number beyond the safe integer range', () => {
    expect(
      messagesAt(updateContactRequestSchema, { lockVersion: 2 ** 53 }, 'lockVersion'),
    ).toContain('Number must be less than or equal to 9007199254740991');
  });

  it('refuses an infinite number', () => {
    expect(
      messagesAt(healthPayloadSchema, { ...HEALTH, uptimeSeconds: Infinity }, 'uptimeSeconds'),
    ).toEqual(['Number must be finite']);
    expect(messagesAt(paymentTermsSchema, { netDays: Infinity }, 'netDays')).toEqual([
      'Expected integer, received float',
    ]);
  });

  it('counts the elements of an array that is too short or too long', () => {
    const request = { quoteId: 'q1', deliveries: [] };
    expect(messagesAt(createOrdersRequestSchema, request, 'deliveries')).toEqual([
      'Array must contain at least 2 element(s)',
    ]);
    const roles = ['Sales', 'Billing', 'Production', 'ProductionManager', 'Admin', 'Sales'];
    expect(messagesAt(setRolesRequestSchema, { identity: IDENTITY, roles }, 'roles')).toEqual([
      'Array must contain at most 5 element(s)',
    ]);
  });

  it('refuses an address that is not an email address', () => {
    expect(messagesAt(createContactRequestSchema, { email: 'pat.example.com' }, 'email')).toEqual([
      'Invalid email',
    ]);
  });

  it('refuses an id that is not a uuid', () => {
    expect(messagesAt(documentSubjectSchema, { type: 'order', id: 'q-17' }, 'id')).toEqual([
      'Invalid uuid',
    ]);
    // The version digit and the variant digit are checked as well as the shape.
    const unversioned = '3f2b8c1e-4a6d-1f1b-1c2e-7d5a1b3c9e0f';
    expect(messagesAt(documentSubjectSchema, { type: 'order', id: unversioned }, 'id')).toEqual([
      'Invalid uuid',
    ]);
    expect(documentSubjectSchema.safeParse({ type: 'order', id: UUID }).success).toBe(true);
  });

  it('refuses a date-time that is not ISO 8601 in UTC with seconds', () => {
    for (const timestamp of ['2027-01-04 09:30:00', '2027-01-04T09:30Z']) {
      expect(messagesAt(healthPayloadSchema, { ...HEALTH, timestamp }, 'timestamp')).toEqual([
        'Invalid datetime',
      ]);
    }
  });

  it('refuses a string that does not match a pattern with no message of its own', () => {
    const list = { asOf: '4 Jan 2027', currentQuarterStart: '2027-01-01', items: [] };
    expect(messagesAt(taxRateSummaryListResponseSchema, list, 'asOf')).toEqual(['Invalid']);
  });

  it('lists the allowed values of an enum', () => {
    const allowed = "'quote' | 'order_confirmation' | 'production'";
    expect(messagesAt(contactRoleSchema, 'shipping', '')).toEqual([
      `Invalid enum value. Expected ${allowed}, received 'shipping'`,
    ]);
    expect(messagesAt(contactRoleSchema, 3, '')).toEqual([`Expected ${allowed}, received number`]);
    expect(messagesAt(contactRoleSchema, undefined, '')).toEqual(['Required']);
  });

  it('names the one value a literal allows', () => {
    expect(messagesAt(healthPayloadSchema, { ...HEALTH, status: 'down' }, 'status')).toEqual([
      'Invalid literal value, expected "ok"',
    ]);
  });

  it('lists the allowed tags of a tagged union', () => {
    expect(messagesAt(freightInputSchema, { mode: 'boat' }, 'mode')).toEqual([
      "Invalid discriminator value. Expected 'pickup' | 'our_vehicle' | 'pass_through' | 'carrier'",
    ]);
  });

  it('keeps a message the schema states itself', () => {
    const address = { line1: '1 Main St', city: 'Spokane', state: 'WA', postalCode: '992' };
    expect(messagesAt(postalAddressSchema, address, 'postalCode')).toEqual([
      'postal code must be 12345 or 12345-6789',
    ]);
    expect(messagesAt(rollWidthSchema, 11.1, '')).toEqual([ROLL_WIDTH_REFUSAL]);
    expect(messagesAt(rollWidthSchema, Infinity, '')).toEqual([ROLL_WIDTH_REFUSAL]);
  });
});

describe('what a person is shown for a refused request', () => {
  it('gives a missing required field as Required under its name', () => {
    const result = createCustomerRequestSchema.safeParse({});
    if (result.success) throw new Error('expected a refusal');
    expect(refusalBody(result.error)).toEqual({
      formErrors: [],
      fieldErrors: { name: ['Required'] },
    });
    expect(result.error.issues[0]).toMatchObject({ path: ['name'], message: 'Required' });
  });

  it('gives a bad value in one field under that field alone', () => {
    const result = createCustomerRequestSchema.safeParse({
      name: 'Acme',
      billingAddress: { line1: '', city: 'Spokane', state: 'WA', postalCode: '99201' },
    });
    if (result.success) throw new Error('expected a refusal');
    expect(refusalBody(result.error)).toEqual({
      formErrors: [],
      fieldErrors: { billingAddress: ['String must contain at least 1 character(s)'] },
    });
    expect(result.error.issues[0]).toMatchObject({
      path: ['billingAddress', 'line1'],
      message: 'String must contain at least 1 character(s)',
    });
  });

  it('gives a refusal of the whole request as a form error', () => {
    const result = createContactRequestSchema.safeParse({});
    if (result.success) throw new Error('expected a refusal');
    expect(refusalBody(result.error)).toEqual({
      formErrors: [CONTACT_NEEDS_NAME_OR_EMAIL],
      fieldErrors: {},
    });
  });
});

// Refusals the package's schemas do not raise today, pinned through small schemas so every sentence is fixed.
describe('the wording of every other refusal', () => {
  const at = (schema: Parser, input: unknown) => messagesAt(schema, input, '');

  // Raises one issue as stated, for the bounds no public check produces.
  function raising(issue: z.core.$ZodRawIssue): Parser {
    return z.any().superRefine((_value, context) => {
      context.addIssue(issue as Parameters<typeof context.addIssue>[0]);
    });
  }

  it('names each kind of value received', () => {
    const text = z.string();
    expect(at(text, Number.NaN)).toEqual(['Expected string, received nan']);
    expect(at(text, [])).toEqual(['Expected string, received array']);
    expect(at(text, new Date(0))).toEqual(['Expected string, received date']);
    expect(at(text, new Map())).toEqual(['Expected string, received map']);
    expect(at(text, new Set())).toEqual(['Expected string, received set']);
    expect(at(text, Promise.resolve('x'))).toEqual(['Expected string, received promise']);
    expect(at(text, { then: 1 })).toEqual(['Expected string, received object']);
    expect(at(text, true)).toEqual(['Expected string, received boolean']);
    expect(at(text, 1n)).toEqual(['Expected string, received bigint']);
  });

  it('refuses a date that is not a date', () => {
    expect(at(z.date(), new Date('not a date'))).toEqual(['Invalid date']);
  });

  it('writes the value a literal allows as JSON, a bigint as its digits', () => {
    expect(at(z.literal(true), false)).toEqual(['Invalid literal value, expected true']);
    expect(at(z.literal(5n), 4n)).toEqual(['Invalid literal value, expected "5"']);
  });

  it('counts the elements of an array', () => {
    expect(at(z.array(z.string()).length(2), ['a'])).toEqual([
      'Array must contain exactly 2 element(s)',
    ]);
    expect(at(z.array(z.string()).length(2), ['a', 'b', 'c'])).toEqual([
      'Array must contain exactly 2 element(s)',
    ]);
    expect(
      at(
        raising({ code: 'too_small', origin: 'array', minimum: 2, inclusive: false, input: [] }),
        [],
      ),
    ).toEqual(['Array must contain more than 2 element(s)']);
    expect(
      at(
        raising({ code: 'too_big', origin: 'array', maximum: 2, inclusive: false, input: [] }),
        [],
      ),
    ).toEqual(['Array must contain less than 2 element(s)']);
  });

  it('counts the characters of a string', () => {
    expect(at(z.string().length(3), 'ab')).toEqual(['String must contain exactly 3 character(s)']);
    expect(at(z.string().length(3), 'abcd')).toEqual([
      'String must contain exactly 3 character(s)',
    ]);
    expect(
      at(
        raising({ code: 'too_small', origin: 'string', minimum: 3, inclusive: false, input: '' }),
        '',
      ),
    ).toEqual(['String must contain over 3 character(s)']);
    expect(
      at(
        raising({ code: 'too_big', origin: 'string', maximum: 3, inclusive: false, input: '' }),
        '',
      ),
    ).toEqual(['String must contain under 3 character(s)']);
  });

  it('states the bound of a number, an integer and a bigint', () => {
    expect(at(z.number().lt(5), 5)).toEqual(['Number must be less than 5']);
    expect(at(z.number().int(), -(2 ** 53))).toEqual([
      'Number must be greater than or equal to -9007199254740991',
    ]);
    expect(
      at(raising({ code: 'too_small', origin: 'number', minimum: 5, exact: true, input: 4 }), 4),
    ).toEqual(['Number must be exactly equal to 5']);
    expect(
      at(raising({ code: 'too_big', origin: 'number', maximum: 5, exact: true, input: 6 }), 6),
    ).toEqual(['Number must be exactly 5']);
    expect(at(z.bigint().min(5n), 4n)).toEqual(['Number must be greater than or equal to 5']);
    expect(at(z.bigint().max(5n), 6n)).toEqual(['BigInt must be less than or equal to 5']);
    expect(at(z.bigint().lt(5n), 5n)).toEqual(['BigInt must be less than 5']);
    expect(
      at(raising({ code: 'too_big', origin: 'bigint', maximum: 5n, exact: true, input: 6n }), 6n),
    ).toEqual(['BigInt must be exactly 5']);
  });

  it('states the bound of a date', () => {
    const day = new Date(Date.UTC(2027, 0, 4));
    const shown = day.toString();
    expect(at(z.date().min(day), new Date(0))).toEqual([
      `Date must be greater than or equal to ${shown}`,
    ]);
    expect(at(z.date().max(day), new Date(Date.UTC(2028, 0, 1)))).toEqual([
      `Date must be smaller than or equal to ${shown}`,
    ]);
    const stamp = day.getTime();
    const date = (issue: Record<string, unknown>) =>
      at(raising({ origin: 'date', input: day, ...issue } as z.core.$ZodRawIssue), day);
    expect(date({ code: 'too_small', minimum: stamp, inclusive: false })).toEqual([
      `Date must be greater than ${shown}`,
    ]);
    expect(date({ code: 'too_small', minimum: stamp, exact: true })).toEqual([
      `Date must be exactly equal to ${shown}`,
    ]);
    expect(date({ code: 'too_big', maximum: stamp, inclusive: false })).toEqual([
      `Date must be smaller than ${shown}`,
    ]);
    expect(date({ code: 'too_big', maximum: stamp, exact: true })).toEqual([
      `Date must be exactly ${shown}`,
    ]);
  });

  it('says only Invalid input for the size of a set', () => {
    expect(at(z.set(z.string()).min(2), new Set(['a']))).toEqual(['Invalid input']);
    expect(at(z.set(z.string()).max(1), new Set(['a', 'b']))).toEqual(['Invalid input']);
  });

  it('names the text a string must start with, end with or include', () => {
    expect(at(z.string().startsWith('WA-'), 'ID')).toEqual([
      'Invalid input: must start with "WA-"',
    ]);
    expect(at(z.string().endsWith('.pdf'), 'a.txt')).toEqual([
      'Invalid input: must end with ".pdf"',
    ]);
    expect(at(z.string().includes('@'), 'pat')).toEqual(['Invalid input: must include "@"']);
    const fromPosition = raising({
      code: 'invalid_format',
      format: 'includes',
      includes: '@',
      position: 2,
      input: '@pat',
    } as z.core.$ZodRawIssue);
    expect(at(fromPosition, '@pat')).toEqual([
      'Invalid input: must include "@" at one or more positions greater than or equal to 2',
    ]);
  });

  it('refuses a guid as an invalid uuid', () => {
    expect(at(z.guid(), 'q-17')).toEqual(['Invalid uuid']);
  });

  it('says Invalid input when no option of a plain union matches', () => {
    expect(at(z.union([z.string(), z.number()]), true)).toEqual(['Invalid input']);
  });

  it('lists tags that are not strings as they are written', () => {
    const tagged = z.discriminatedUnion('sendable', [
      z.object({ sendable: z.literal(true) }),
      z.object({ sendable: z.literal(false), reason: z.string() }),
    ]);
    expect(messagesAt(tagged, { sendable: 'yes' }, 'sendable')).toEqual([
      'Invalid discriminator value. Expected true | false',
    ]);
  });

  it('lists the keys an object does not know', () => {
    expect(at(z.strictObject({ a: z.string() }), { a: 'x', b: 1, c: 2 })).toEqual([
      "Unrecognized key(s) in object: 'b', 'c'",
    ]);
  });

  it('names the step a number must be a multiple of', () => {
    expect(at(z.number().multipleOf(5), 7)).toEqual(['Number must be a multiple of 5']);
  });

  it('says Invalid input for a refinement with no message of its own', () => {
    expect(
      at(
        z.string().refine(() => false),
        'x',
      ),
    ).toEqual(['Invalid input']);
  });
});
