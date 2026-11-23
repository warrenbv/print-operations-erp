// A customer's quoting defaults and parts. Saving is gated to `CUSTOMER_DEFAULTS_WRITE_ROLES`, and reading is open.
// A save carries the `lockVersion` it read, and a stale one is answered 409: docs/decisions/006-optimistic-concurrency.md.
import { CustomerDefaultsCustomerNotFoundError, CustomerDefaultsService } from '@erp/crm';
import { StaleAggregateError } from '@erp/db';
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Put,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import {
  CUSTOMER_DEFAULTS_WRITE_ROLES,
  customerDefaultsSchema,
  putCustomerDefaultsRequestSchema,
  refusalBody,
  type CustomerDefaults,
} from '@erp/types';

import { Authenticated, RequireRoles } from '../auth/authz.decorators';
import type { AuthenticatedRequest } from '../auth/session.guard';
import { UuidParam } from '../params.decorators';

@Controller('crm/customers/:customerId/defaults')
export class CrmCustomerDefaultsController {
  constructor(
    @Inject(CustomerDefaultsService) private readonly defaults: CustomerDefaultsService,
  ) {}

  @Authenticated()
  @Get()
  async find(@UuidParam('customerId') customerId: string): Promise<CustomerDefaults> {
    const found = await this.defaults.find(customerId);
    if (found === null) {
      throw new NotFoundException();
    }
    return customerDefaultsSchema.parse(found);
  }

  @RequireRoles(...CUSTOMER_DEFAULTS_WRITE_ROLES)
  @Put()
  async replace(
    @UuidParam('customerId') customerId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<CustomerDefaults> {
    if (request.erpUser === undefined) {
      throw new UnauthorizedException();
    }
    const parsed = putCustomerDefaultsRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(refusalBody(parsed.error));
    }
    try {
      const result = await this.defaults.replace(
        customerId,
        parsed.data,
        // The saver is recorded from the session, never from the body.
        request.erpUser.username,
      );
      if (!result.ok) {
        throw new NotFoundException();
      }
      return customerDefaultsSchema.parse(result.defaults);
    } catch (err) {
      if (err instanceof CustomerDefaultsCustomerNotFoundError) {
        throw new NotFoundException();
      }
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
