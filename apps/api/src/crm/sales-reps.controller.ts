// The Sales role's holders, for sales-rep pickers and filters. It reads identity's users, so it takes the identity stores.
import { BadRequestException, Controller, Get, Inject, Query } from '@nestjs/common';
import {
  resolvedSalesRepListResponseSchema,
  salesRepListResponseSchema,
  SALES_REP_RESOLVE_MAX_NAMES,
  type ResolvedSalesRepListResponse,
  type SalesRepListResponse,
} from '@erp/types';

import { Authenticated } from '../auth/authz.decorators';
import { IDENTITY_STORES, type IdentityStores } from '../auth/auth.factory';
import { resolveSalesReps } from './resolve-sales-reps';

@Controller('sales-reps')
export class SalesRepsController {
  constructor(@Inject(IDENTITY_STORES) private readonly identity: IdentityStores) {}

  @Authenticated()
  @Get()
  async list(): Promise<SalesRepListResponse> {
    const holders = await this.identity.users.listByRole('Sales');
    return salesRepListResponseSchema.parse({
      items: holders.map((holder) => ({
        username: holder.username,
        displayName: holder.displayName,
      })),
    });
  }

  @Authenticated()
  @Get('resolve')
  async resolve(@Query('usernames') usernames?: unknown): Promise<ResolvedSalesRepListResponse> {
    // One comma-separated value. A repeated or bracketed parameter arrives as an array or an object
    // and is refused, as the list routes refuse a malformed filter: apps/api/src/list-query.ts.
    if (usernames !== undefined && typeof usernames !== 'string') {
      throw new BadRequestException({ reason: 'invalid-usernames' });
    }
    const wanted = (usernames ?? '')
      .split(',')
      .map((part) => part.trim())
      .filter((part) => part !== '');
    if (wanted.length > SALES_REP_RESOLVE_MAX_NAMES) {
      throw new BadRequestException(
        `at most ${String(SALES_REP_RESOLVE_MAX_NAMES)} usernames can be resolved at once`,
      );
    }
    const resolved = await resolveSalesReps(this.identity.users, wanted);
    return resolvedSalesRepListResponseSchema.parse({ items: [...resolved.values()] });
  }
}
