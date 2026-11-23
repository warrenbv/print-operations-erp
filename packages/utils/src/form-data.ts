// Reads text fields from a submitted `FormData` in the web app's server actions, for example
// apps/web/src/app/approvals/actions.ts.
/**
 * The field's value. Throws when the field is absent, empty or a file, naming the field. Whitespace
 * passes unchanged. Use `optionalString` for a field the person may leave blank.
 */
export function requireString(form: FormData, key: string): string {
  const value = form.get(key);
  if (typeof value !== 'string' || value === '') {
    throw new Error(`Missing form field: ${key}`);
  }
  return value;
}

/** The trimmed value, or `undefined` when the field is absent, blank or a file. */
export function optionalString(form: FormData, key: string): string | undefined {
  const value = form.get(key);
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}
