// Identifies a received file from its leading bytes. The type the client declared is not trusted, and
// anything unrecognised is refused. Received documents are stored as opaque bytes and never parsed.
// See Received documents in docs/decisions/README.md.
import type { ReceivedContentType } from '@erp/types';

interface Signature {
  readonly contentType: ReceivedContentType;
  readonly prefix: readonly number[];

  readonly offset?: number;
}

const SIGNATURES: readonly Signature[] = [
  { contentType: 'application/pdf', prefix: [0x25, 0x50, 0x44, 0x46] },
  { contentType: 'image/jpeg', prefix: [0xff, 0xd8, 0xff] },
  { contentType: 'image/png', prefix: [0x89, 0x50, 0x4e, 0x47] },
  { contentType: 'image/tiff', prefix: [0x49, 0x49, 0x2a, 0x00] },
  { contentType: 'image/tiff', prefix: [0x4d, 0x4d, 0x00, 0x2a] },
];

const ZIP_PREFIX = [0x50, 0x4b, 0x03, 0x04] as const;

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function startsWith(bytes: Uint8Array, prefix: readonly number[], offset = 0): boolean {
  if (bytes.length < offset + prefix.length) return false;
  return prefix.every((byte, index) => bytes[offset + index] === byte);
}

export function identifyReceivedBytes(
  bytes: Uint8Array,
  declared: string,
): ReceivedContentType | null {
  for (const signature of SIGNATURES) {
    if (startsWith(bytes, signature.prefix, signature.offset)) {
      return signature.contentType;
    }
  }

  // DOCX and XLSX are both zip archives with the same signature, so the declared type picks between
  // them. A renamed zip that claims one of them passes. That limit is known and pinned in
  // modules/documents/test/magic-bytes.test.ts.
  if (startsWith(bytes, ZIP_PREFIX)) {
    if (declared === DOCX) return DOCX;
    if (declared === XLSX) return XLSX;
    return null;
  }

  return null;
}
