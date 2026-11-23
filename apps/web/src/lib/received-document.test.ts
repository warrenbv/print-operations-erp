// Tests the refusal for a received document over the size limit.
import { describe, expect, it } from 'vitest';

import { RECEIVED_DOCUMENT_MAX_BYTES } from '@erp/types';

import { RECEIVED_DOCUMENT_MAX_MB, receivedDocumentTooLarge } from './received-document';

const MB = 1024 * 1024;

describe('receivedDocumentTooLarge', () => {
  it('lets a file up to the limit through, the limit included', () => {
    expect(receivedDocumentTooLarge(1)).toBeUndefined();
    expect(receivedDocumentTooLarge(24 * MB)).toBeUndefined();
    expect(receivedDocumentTooLarge(RECEIVED_DOCUMENT_MAX_BYTES)).toBeUndefined();
  });

  it('refuses a 31 MB file with its size and the limit', () => {
    expect(receivedDocumentTooLarge(31 * MB)).toBe(
      'That file is 31.0 MB, and the limit is 25 MB. Save a smaller copy and attach it again.',
    );
  });

  it('refuses one byte over, and never reads as the limit itself', () => {
    expect(receivedDocumentTooLarge(RECEIVED_DOCUMENT_MAX_BYTES + 1)).toBe(
      'That file is 25.1 MB, and the limit is 25 MB. Save a smaller copy and attach it again.',
    );
  });

  it('rounds the size up to one decimal place', () => {
    expect(receivedDocumentTooLarge(31 * MB + 1)).toContain('That file is 31.1 MB,');

    expect(receivedDocumentTooLarge(33.5 * MB)).toContain('That file is 33.5 MB,');
    expect(receivedDocumentTooLarge(41.93 * MB)).toContain('That file is 42.0 MB,');
  });

  it('reads the limit from RECEIVED_DOCUMENT_MAX_BYTES', () => {
    expect(RECEIVED_DOCUMENT_MAX_MB).toBe(RECEIVED_DOCUMENT_MAX_BYTES / MB);
    expect(RECEIVED_DOCUMENT_MAX_MB).toBe(25);
    expect(receivedDocumentTooLarge(RECEIVED_DOCUMENT_MAX_BYTES + 1)).toContain(
      `the limit is ${String(RECEIVED_DOCUMENT_MAX_MB)} MB.`,
    );
  });
});
