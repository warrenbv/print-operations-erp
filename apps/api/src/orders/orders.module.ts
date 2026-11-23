// Wires orders. It imports quoting for the quote lookup, and documents, crm and notifications for the confirmation.
import { ContactService, CustomerService } from '@erp/crm';
import { DocumentService } from '@erp/documents';
import { OrderService } from '@erp/orders';
import { QuoteService } from '@erp/quoting';
import { Module } from '@nestjs/common';

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
import { QuotingModule } from '../quoting/quoting.module';
import { OrdersController } from './orders.controller';
import { OrdersStoresModule } from './orders-stores.module';
import { ORDERS_STORES, createOrderService } from './orders.factory';

@Module({
  imports: [
    AuthModule,
    QuotingModule,
    DocumentsModule,
    CrmModule,
    NotificationsModule,
    OrdersStoresModule,
  ],
  controllers: [OrdersController],
  providers: [
    {
      provide: OrderService,
      useFactory: createOrderService,
      inject: [
        ORDERS_STORES,
        QuoteService,
        DocumentService,
        ContactService,
        MAIL_SINK,
        IDENTITY_STORES,
        CustomerService,
        SEND_LOG,

        SENDER_NOTIFIER,
        MAIL_LOG,
      ],
    },
  ],

  exports: [OrderService],
})
export class OrdersModule {}
