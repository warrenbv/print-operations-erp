// Wires identity into the API and registers the two global guards.
// Nest runs global guards in the order they are registered. The session guard must set the user before the role guard reads it.
import { AuthenticationService } from '@erp/identity';
import { Inject, Module, type OnModuleDestroy } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';

import { AuthController } from './auth.controller';
import {
  IDENTITY_STORES,
  READ_ONLY_USERNAMES,
  createAuthenticationService,
  createIdentityStores,
  resolveReadOnlyUsernames,
  type IdentityStores,
} from './auth.factory';
import { RolesGuard } from './roles.guard';
import { SessionGuard } from './session.guard';

@Module({
  controllers: [AuthController],
  providers: [
    {
      provide: IDENTITY_STORES,
      useFactory: createIdentityStores,
    },
    {
      provide: AuthenticationService,
      useFactory: createAuthenticationService,
      inject: [IDENTITY_STORES],
    },
    {
      provide: READ_ONLY_USERNAMES,
      useFactory: () => resolveReadOnlyUsernames(process.env),
    },

    SessionGuard,
    RolesGuard,
    { provide: APP_GUARD, useExisting: SessionGuard },
    { provide: APP_GUARD, useExisting: RolesGuard },
  ],

  exports: [AuthenticationService, SessionGuard, RolesGuard, IDENTITY_STORES],
})
export class AuthModule implements OnModuleDestroy {
  constructor(@Inject(IDENTITY_STORES) private readonly stores: IdentityStores) {}

  async onModuleDestroy(): Promise<void> {
    await this.stores.close();
  }
}
