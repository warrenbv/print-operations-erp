// Document contracts: generated quote and confirmation PDFs, and received documents such as a customer's PO.
// The kind, source, subject and content-type lists are mirrored by CHECK constraints in
// infra/db/migrations/documents/0000_baseline.sql. The service: modules/documents/src/services/document-service.ts.
import { z } from 'zod';

export const DOCUMENT_KINDS = ['quote', 'order_confirmation', 'purchase_order'] as const;

export const documentKindSchema = z.enum(DOCUMENT_KINDS);

export type DocumentKind = z.infer<typeof documentKindSchema>;

export const DOCUMENT_SOURCES = ['generated', 'received'] as const;

export const documentSourceSchema = z.enum(DOCUMENT_SOURCES);

export type DocumentSource = z.infer<typeof documentSourceSchema>;

export const RECEIVED_CONTENT_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/tiff',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
] as const;

export const receivedContentTypeSchema = z.enum(RECEIVED_CONTENT_TYPES);

export type ReceivedContentType = z.infer<typeof receivedContentTypeSchema>;

// Every received type, plus PDF, which a generated document always is.
export const storedContentTypeSchema = z.enum([
  'application/pdf',
  ...RECEIVED_CONTENT_TYPES.filter((type) => type !== 'application/pdf'),
]);

export const RECEIVED_DOCUMENT_MAX_BYTES = 25 * 1024 * 1024;

export const DOCUMENT_STORAGE_FAILURES = [
  'not-writable',
  'missing',
  'full',
  'not-a-directory',
  'unknown',
] as const;

export type DocumentStorageFailure = (typeof DOCUMENT_STORAGE_FAILURES)[number];

export const DOCUMENT_SUBJECT_TYPES = ['order', 'quote'] as const;

export const documentSubjectTypeSchema = z.enum(DOCUMENT_SUBJECT_TYPES);

export type DocumentSubjectType = z.infer<typeof documentSubjectTypeSchema>;

export const documentSubjectSchema = z.object({
  type: documentSubjectTypeSchema,
  id: z.uuid(),
});

export type DocumentSubject = z.infer<typeof documentSubjectSchema>;

export const renderedDocumentSchema = z.object({
  kind: documentKindSchema,

  filename: z.string().min(1),
  contentType: z.literal('application/pdf'),

  bytes: z.custom<Uint8Array>((value) => value instanceof Uint8Array, {
    error: 'bytes must be a Uint8Array',
  }),

  generatedAt: z.iso.datetime(),
});

export type RenderedDocument = z.infer<typeof renderedDocumentSchema>;

export const storedDocumentSchema = z.object({
  id: z.uuid(),
  kind: documentKindSchema,
  subject: documentSubjectSchema,

  filename: z.string().min(1),

  storagePath: z.string().min(1),

  contentType: storedContentTypeSchema,
  byteSize: z.number().int().positive(),

  checksumSha256: z.string().regex(/^[0-9a-f]{64}$/, 'must be a lowercase hex sha-256'),

  documentAt: z.iso.datetime(),

  storedAt: z.iso.datetime(),

  source: documentSourceSchema,

  uploadedBy: z.string().trim().min(1).max(128).nullable(),

  originalFilename: z.string().min(1).max(255).nullable(),
});

export type StoredDocument = z.infer<typeof storedDocumentSchema>;

// The summary leaves out `storagePath`, so the server's file path is not sent to callers.
export const storedDocumentSummarySchema = storedDocumentSchema.omit({ storagePath: true });

export type StoredDocumentSummary = z.infer<typeof storedDocumentSummarySchema>;

export const orderDocumentListResponseSchema = z.object({
  documents: z.array(storedDocumentSummarySchema),
});

export type OrderDocumentListResponse = z.infer<typeof orderDocumentListResponseSchema>;
