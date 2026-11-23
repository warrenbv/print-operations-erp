# Documents module

## What it is responsible for

This module turns a quote or an order into a customer document and keeps every document the system holds. It renders the quote PDF and the order confirmation PDF, and it stores the purchase order a customer sends as opaque bytes. It decides no business outcome. It prints figures that quoting and orders have already settled.

## Public surface

Other code imports only from `@erp/documents`, which is [src/index.ts](src/index.ts):

- `DocumentService`, which renders, stores, reads and lists documents.
- `buildQuoteDocument` and `buildOrderConfirmationDocument`, the two templates, and `DEMO_BRAND`, the letterhead they print.
- The adapters the API wires: `ReactPdfDocumentRenderer`, `LocalFileDocumentStore`, `InMemoryDocumentStore`, `DrizzleStoredDocumentRepository`, `InMemoryStoredDocumentRepository`, `createDocumentsDb` and `systemClock`.
- The errors the API maps to HTTP replies: `DocumentTooLargeError`, `UnsupportedDocumentTypeError` and `DocumentStorageError`.

Nothing may import from `src/` directly. The lint rule in [packages/config/eslint/boundaries.mjs](../../packages/config/eslint/boundaries.mjs) refuses it. The templates take quoting's and orders' types from `packages/types`. A module that only renders another module's data may take the provider's type: [docs/decisions/002-what-crosses-a-module-boundary.md](../../docs/decisions/002-what-crosses-a-module-boundary.md).

The API composes it in [apps/api/src/documents/documents.factory.ts](../../apps/api/src/documents/documents.factory.ts), which picks both the file store and the record repository from `DATA_PERSISTENCE`: [docs/decisions/007-persistence-switch-at-the-composition-root.md](../../docs/decisions/007-persistence-switch-at-the-composition-root.md). The callers are [apps/api/src/quoting/quotes.controller.ts](../../apps/api/src/quoting/quotes.controller.ts) and [apps/api/src/orders/orders.controller.ts](../../apps/api/src/orders/orders.controller.ts).

## State it owns

- The PostgreSQL schema `documents` with one table, `stored_documents`: one row per stored file, keyed to its quote or order by subject type and id, with no foreign key. Schema in [src/data/schema.ts](src/data/schema.ts). Migration in [infra/db/migrations/documents/0000_baseline.sql](../../infra/db/migrations/documents/0000_baseline.sql), whose hand-written CHECK constraints hold the kinds, sources and content types to the values in [packages/types/src/document.ts](../../packages/types/src/document.ts).
- The files themselves. In Postgres mode `LocalFileDocumentStore` writes them to a directory tree under `DOCUMENT_STORAGE_ROOT`, by kind, then UTC year and month, and the API refuses to start unless that root is writable. In memory mode `InMemoryDocumentStore` holds generated and uploaded documents in memory beside the in-memory records, so nothing is written to disk and nothing survives a restart. Either way a stored file is written once and never overwritten.

It owns no state machine. A document is either generated (a quote or an order confirmation) or received (a purchase order).

## Rules it enforces

- The order confirmation prints the order's own copied lines and prices, not the quote's. The PO document is stored against the order. See [docs/product/requirements.md](../../docs/product/requirements.md) (R9).
- Freight waiting on a carrier bid prints the pending marker the requirement names, never a figure: [docs/product/requirements.md](../../docs/product/requirements.md) (R4).
- The committed lead time prints as calendar days from the confirmation day: [docs/product/requirements.md](../../docs/product/requirements.md) (R11).
- A received file is identified from its bytes, not from the type the client declared. Anything unrecognised or over the size cap is refused before it is written.
- Received documents are never parsed. The module may not depend on any library that could read one. See Received documents in [docs/decisions/README.md](../../docs/decisions/README.md).
- Templates build a declarative model and the PDF engine is one adapter behind a port. See Document rendering in [docs/decisions/README.md](../../docs/decisions/README.md).

## Where to start reading

- [src/services/document-service.ts](src/services/document-service.ts): every operation, and the order in which it writes.
- [src/templates/quote-document.ts](src/templates/quote-document.ts): what the customer reads on a quote.
- [src/templates/order-confirmation-document.ts](src/templates/order-confirmation-document.ts): what the customer reads once Production confirms.
- [src/document-model.ts](src/document-model.ts): the blocks a template may use.
- [src/magic-bytes.ts](src/magic-bytes.ts): how a received file is identified, and its one known limit.
- [src/adapters/local-file/local-file-document-store.ts](src/adapters/local-file/local-file-document-store.ts): paths, write-once storage and failure mapping. [src/adapters/in-memory/in-memory-document-store.ts](src/adapters/in-memory/in-memory-document-store.ts) is its in-memory counterpart.

## Tests

- Template tests build document models and assert the wording, columns and notices a customer sees.
- Layout tests render real PDFs and read text positions back from the bytes, to check rows, gutters and word wrapping.
- A parity test runs the quote template against the fixture the web app's review step also reads, so the page and the PDF cannot disagree.
- Two contract suites in [test/contracts/](test/contracts/). The stored-document repository suite runs against the in-memory and the PostgreSQL repository. The document store suite runs against `InMemoryDocumentStore` and `LocalFileDocumentStore` on a temporary directory, so both refuse an overwrite, refuse a path outside the root, report a missing file the same way, and keep bytes that later edits to the caller's buffer cannot change.
- Structural tests keep the brand out of the templates and any document-reading library out of the dependencies.

`pnpm test` runs everything except the PostgreSQL contract run, which skips without a database. `pnpm test:db` runs the same suite against a throwaway local Postgres, including that run and the CHECK constraint test.
