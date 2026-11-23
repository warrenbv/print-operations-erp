// Wires the Admin section. The notifications module supplies the send log the role catalogue reads.
import { AdminRoleService } from '@erp/identity';
import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { IDENTITY_STORES } from '../auth/auth.factory';
import { NotificationsModule } from '../notifications/notifications.module';
import { AdminController } from './admin.controller';
import { createAdminRoleService } from './admin.factory';
import { RoleCatalogController } from './role-catalog.controller';

@Module({
  imports: [AuthModule, NotificationsModule],
  controllers: [AdminController, RoleCatalogController],
  providers: [
    {
      provide: AdminRoleService,
      useFactory: createAdminRoleService,
      inject: [IDENTITY_STORES],
    },
  ],
  exports: [AdminRoleService],
})
export class AdminModule {}
