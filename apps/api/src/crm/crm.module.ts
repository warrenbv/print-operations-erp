// Wires crm. Its services are exported because quoting and orders read customers and contacts.
import { ContactService, CustomerDefaultsService, CustomerService } from '@erp/crm';
import { Inject, Module, type OnModuleDestroy } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { CrmAgreedPriceController } from './crm-agreed-price.controller';
import { CrmContactController } from './crm-contact.controller';
import { CrmCustomerDefaultsController } from './crm-customer-defaults.controller';
import { CrmController } from './crm.controller';
import { SalesRepsController } from './sales-reps.controller';
import {
  CRM_STORES,
  createContactService,
  createCustomerDefaultsService,
  createCrmStores,
  createCustomerService,
  type CrmStores,
} from './crm.factory';

@Module({
  imports: [AuthModule],

  controllers: [
    CrmController,
    CrmContactController,
    CrmCustomerDefaultsController,

    CrmAgreedPriceController,
    SalesRepsController,
  ],
  providers: [
    { provide: CRM_STORES, useFactory: createCrmStores },
    {
      provide: CustomerService,
      useFactory: createCustomerService,
      inject: [CRM_STORES],
    },
    {
      provide: ContactService,
      useFactory: createContactService,
      inject: [CRM_STORES],
    },
    {
      provide: CustomerDefaultsService,
      useFactory: createCustomerDefaultsService,
      inject: [CRM_STORES],
    },
  ],
  exports: [CustomerService, ContactService, CustomerDefaultsService],
})
export class CrmModule implements OnModuleDestroy {
  constructor(@Inject(CRM_STORES) private readonly stores: CrmStores) {}

  async onModuleDestroy(): Promise<void> {
    await this.stores.close();
  }
}
