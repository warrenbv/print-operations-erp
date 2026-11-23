// The edge cases of the form-field helpers: empty, whitespace, files and repeated keys.
import { describe, expect, it } from 'vitest';

import { optionalString, requireString } from '../src/form-data';

function form(fields: Record<string, string | Blob>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.append(key, value);
  return data;
}

describe('requireString', () => {
  it('returns the submitted value', () => {
    expect(requireString(form({ reason: 'wrong grade' }), 'reason')).toBe('wrong grade');
  });

  it('names the missing key, because the reader of that message is us', () => {
    expect(() => requireString(form({}), 'reason')).toThrow('Missing form field: reason');
  });

  it('refuses an empty string, which is what an untouched text input submits', () => {
    expect(() => requireString(form({ reason: '' }), 'reason')).toThrow('Missing form field');
  });

  it('accepts whitespace-only, and that is deliberate', () => {
    expect(requireString(form({ reason: '   ' }), 'reason')).toBe('   ');
  });

  it('refuses a file, so an upload field cannot pass as text', () => {
    expect(() => requireString(form({ document: new Blob(['x']) }), 'document')).toThrow(
      'Missing form field: document',
    );
  });

  it('reads the first value when a key was submitted twice', () => {
    const data = form({ role: 'Billing' });
    data.append('role', 'Sales');
    expect(requireString(data, 'role')).toBe('Billing');
  });
});

describe('optionalString', () => {
  it('returns the value, trimmed', () => {
    expect(optionalString(form({ note: '  from the PO email  ' }), 'note')).toBe(
      'from the PO email',
    );
  });

  it('answers undefined for a key nobody submitted', () => {
    expect(optionalString(form({}), 'note')).toBeUndefined();
  });

  it('answers undefined for an empty field', () => {
    expect(optionalString(form({ note: '' }), 'note')).toBeUndefined();
  });

  it('answers undefined for whitespace-only, which is empty in every sense a reader means', () => {
    expect(optionalString(form({ note: '   ' }), 'note')).toBeUndefined();
  });

  it('answers undefined for a file rather than stringifying it', () => {
    expect(optionalString(form({ document: new Blob(['x']) }), 'document')).toBeUndefined();
  });
});
