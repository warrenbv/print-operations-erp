// The root module. Each imported module wires one business module: its factory, its providers and its controllers.
// The documents module is imported by the quoting and orders modules. Which controller fronts which module: apps/api/README.md.
import { Module } from '@nestjs/common';
import { AdminModule } from './admin/admin.module';
import { ApprovalsModule } from './approvals/approvals.module';
import { AuthModule } from './auth/auth.module';
import { CrmModule } from './crm/crm.module';
import { HealthModule } from './health/health.module';
import { NotificationsModule } from './notifications/notifications.module';
import { OrdersModule } from './orders/orders.module';
import { QuotingModule } from './quoting/quoting.module';

@Module({
  imports: [
    AdminModule,
    ApprovalsModule,
    AuthModule,
    CrmModule,
    HealthModule,
    NotificationsModule,
    OrdersModule,
    QuotingModule,
  ],
})
export class AppModule {}
