// Wires quoting. It imports the order store module rather than the orders module, because orders already imports quoting.
import { TaxCodeLookupService, TaxRateService } from '@erp/quoting';
import { CustomerDefaultsService, CustomerService } from '@erp/crm';
import { DocumentService } from '@erp/documents';
import {
  GradeService,
  PricingConfigService,
  PricingTierService,
  QuotePricingService,
  QuoteService,
  RollCostService,
} from '@erp/quoting';
import { Inject, Module, type OnModuleDestroy } from '@nestjs/common';

import { IDENTITY_STORES } from '../auth/auth.factory';
import { AuthModule } from '../auth/auth.module';
import { CrmModule } from '../crm/crm.module';
import { DocumentsModule } from '../documents/documents.module';
import {
  MAIL_LOG,
  MAIL_SINK,
  SENDER_NOTIFIER,
  SEND_LOG,
} from '../notifications/notifications.factory';
import { NotificationsModule } from '../notifications/notifications.module';
import { ORDERS_STORES } from '../orders/orders.factory';
import { OrdersStoresModule } from '../orders/orders-stores.module';
import { CatalogController } from './catalog.controller';
import { QuotesController } from './quotes.controller';
import { CreditApprovalsController } from './credit-approvals.controller';
import { TaxCodeLookupController } from './tax-code-lookup.controller';
import { TaxRatesController } from './tax-rates.controller';
import {
  QUOTING_STORES,
  createTaxCodeLookupService,
  createTaxRateService,
  createGradeService,
  createPricingConfigService,
  createPricingTierService,
  createQuotePricingService,
  createQuoteService,
  createQuotingStores,
  createRollCostService,
  type QuotingStores,
} from './quoting.factory';

@Module({
  imports: [AuthModule, CrmModule, DocumentsModule, NotificationsModule, OrdersStoresModule],
  controllers: [
    CatalogController,
    QuotesController,
    CreditApprovalsController,
    TaxRatesController,
    TaxCodeLookupController,
  ],
  providers: [
    { provide: QUOTING_STORES, useFactory: createQuotingStores },
    {
      provide: GradeService,
      useFactory: createGradeService,
      inject: [QUOTING_STORES],
    },
    {
      provide: PricingConfigService,
      useFactory: createPricingConfigService,
      inject: [QUOTING_STORES],
    },
    {
      provide: PricingTierService,
      useFactory: createPricingTierService,
      inject: [QUOTING_STORES],
    },
    {
      provide: RollCostService,
      useFactory: createRollCostService,
      inject: [QUOTING_STORES],
    },
    {
      provide: QuotePricingService,
      useFactory: createQuotePricingService,
      inject: [QUOTING_STORES, RollCostService],
    },
    {
      provide: QuoteService,
      useFactory: createQuoteService,
      inject: [
        QUOTING_STORES,
        QuotePricingService,
        CustomerService,
        ORDERS_STORES,
        DocumentService,
        MAIL_SINK,

        IDENTITY_STORES,

        SEND_LOG,

        SENDER_NOTIFIER,

        CustomerDefaultsService,
        MAIL_LOG,
      ],
    },

    {
      provide: TaxRateService,
      useFactory: createTaxRateService,
      inject: [QUOTING_STORES],
    },

    {
      provide: TaxCodeLookupService,
      useFactory: createTaxCodeLookupService,
      inject: [QUOTING_STORES],
    },
  ],

  exports: [QuoteService, PricingConfigService, GradeService, TaxRateService, QuotePricingService],
})
export class QuotingModule implements OnModuleDestroy {
  constructor(@Inject(QUOTING_STORES) private readonly stores: QuotingStores) {}

  async onModuleDestroy(): Promise<void> {
    await this.stores.close();
  }
}
