// A customer's agreed price for a part. Setting it is gated to the roles that decide a hand-set price, `PRICE_OVERRIDE_APPROVAL_ROLES` in packages/types/src/roles.ts.
// A stale `lockVersion` is answered 409: docs/decisions/006-optimistic-concurrency.md. Service: modules/crm/src/services/customer-defaults-service.ts.
import { CustomerDefaultsService } from '@erp/crm';
import { StaleAggregateError } from '@erp/db';
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Inject,
  NotFoundException,
  Put,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import {
  PRICE_OVERRIDE_APPROVAL_ROLES,
  customerDefaultsSchema,
  refusalBody,
  setAgreedPriceRequestSchema,
  type CustomerDefaults,
} from '@erp/types';

import { RequireRoles } from '../auth/authz.decorators';
import type { AuthenticatedRequest } from '../auth/session.guard';
import { UuidParam } from '../params.decorators';

@Controller('crm/customers/:customerId/parts')
export class CrmAgreedPriceController {
  constructor(
    @Inject(CustomerDefaultsService) private readonly defaults: CustomerDefaultsService,
  ) {}

  @RequireRoles(...PRICE_OVERRIDE_APPROVAL_ROLES)
  @Put('agreed-price')
  async setAgreedPrice(
    @UuidParam('customerId') customerId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<CustomerDefaults> {
    if (request.erpUser === undefined) {
      throw new UnauthorizedException();
    }
    const parsed = setAgreedPriceRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(refusalBody(parsed.error));
    }
    try {
      const result = await this.defaults.setAgreedPrice(
        customerId,
        parsed.data,
        // The setter is recorded from the session, never from the body.
        request.erpUser.username,
      );
      if (!result.ok) {
        throw new NotFoundException();
      }
      return customerDefaultsSchema.parse(result.defaults);
    } catch (err) {
      if (err instanceof StaleAggregateError) {
        throw new ConflictException({
          reason: 'stale-aggregate',
          value: { expected: err.expected, actual: err.actual },
        });
      }
      throw err;
    }
  }
}
