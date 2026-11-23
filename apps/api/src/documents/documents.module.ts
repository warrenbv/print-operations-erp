// Wires documents and the global filter for storage failures. The quoting and orders modules import it.
import { DocumentService } from '@erp/documents';
import { Inject, Module, type OnModuleDestroy } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';

import { DocumentStorageFilter } from './document-storage.filter';
import {
  DOCUMENTS_STORES,
  createDocumentService,
  createDocumentsStores,
  type DocumentsStores,
} from './documents.factory';

@Module({
  providers: [
    { provide: DOCUMENTS_STORES, useFactory: createDocumentsStores },
    {
      provide: DocumentService,
      useFactory: createDocumentService,
      inject: [DOCUMENTS_STORES],
    },

    { provide: APP_FILTER, useClass: DocumentStorageFilter },
  ],
  exports: [DocumentService],
})
export class DocumentsModule implements OnModuleDestroy {
  constructor(@Inject(DOCUMENTS_STORES) private readonly stores: DocumentsStores) {}

  async onModuleDestroy(): Promise<void> {
    await this.stores.close();
  }
}
