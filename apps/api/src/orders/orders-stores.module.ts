// Holds the order store on its own. The orders module imports quoting, and quoting needs the order store, so this avoids a cycle.
import { Inject, Module, type OnModuleDestroy } from '@nestjs/common';

import { ORDERS_STORES, createOrdersStores, type OrdersStores } from './orders.factory';

@Module({
  providers: [{ provide: ORDERS_STORES, useFactory: createOrdersStores }],
  exports: [ORDERS_STORES],
})
export class OrdersStoresModule implements OnModuleDestroy {
  constructor(@Inject(ORDERS_STORES) private readonly stores: OrdersStores) {}

  async onModuleDestroy(): Promise<void> {
    await this.stores.close();
  }
}
