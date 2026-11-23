// Tests for the document kind and subject type lists.
import { describe, expect, it } from 'vitest';

import {
  DOCUMENT_KINDS,
  DOCUMENT_SUBJECT_TYPES,
  documentKindSchema,
  documentSubjectSchema,
  documentSubjectTypeSchema,
} from '../src/document';

const SUBJECT_ID = '01988a00-0100-7000-8000-000000000001';

describe('DOCUMENT_SUBJECT_TYPES', () => {
  it('still carries the two it always had', () => {
    expect(DOCUMENT_SUBJECT_TYPES).toContain('order');
    expect(DOCUMENT_SUBJECT_TYPES).toContain('quote');
  });

  it('names every subject in the form the CHECK constraint stores', () => {
    for (const type of DOCUMENT_SUBJECT_TYPES) {
      expect(type, type).toMatch(/^[a-z][a-z_]*$/);
    }
  });

  it('accepts every declared type as a subject', () => {
    for (const type of DOCUMENT_SUBJECT_TYPES) {
      expect(documentSubjectSchema.safeParse({ type, id: SUBJECT_ID }).success, type).toBe(true);
    }
  });

  it('rejects a type outside the set', () => {
    expect(documentSubjectTypeSchema.safeParse('customer').success).toBe(false);
  });

  it('requires the subject id to be a uuid', () => {
    expect(documentSubjectSchema.safeParse({ type: 'order', id: 'not-a-uuid' }).success).toBe(
      false,
    );
  });
});

describe('DOCUMENT_KINDS', () => {
  it('names every kind in the form the CHECK constraint stores', () => {
    expect([...DOCUMENT_KINDS]).toEqual(['quote', 'order_confirmation', 'purchase_order']);
  });

  it('keeps the received kind last, after everything we render', () => {
    expect(DOCUMENT_KINDS.at(-1)).toBe('purchase_order');
  });

  it('rejects a kind outside the set', () => {
    expect(documentKindSchema.safeParse('bol').success).toBe(false);
    expect(documentKindSchema.safeParse('bill-of-lading').success).toBe(false);
  });
});
