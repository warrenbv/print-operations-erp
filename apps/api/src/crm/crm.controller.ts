// Customers: create, edit, search, and the credit hold.
// Only `CREDIT_HOLD_ROLES` set or clear the hold: docs/product/requirements.md (R2). Service: modules/crm/src/services/customer-service.ts.
import { CustomerService, DuplicateLegacyAccountNumberError } from '@erp/crm';
import { StaleAggregateError } from '@erp/db';
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import {
  createCustomerRequestSchema,
  customerSchema,
  customerNameListResponseSchema,
  refusalBody,
  setCreditHoldRequestSchema,
  customerSearchQuerySchema,
  customerSearchResponseSchema,
  updateCustomerRequestSchema,
  CREDIT_HOLD_ROLES,
  CUSTOMER_NAME_LIST_MAX,
  SALES_WRITE_ROLES,
  type Customer,
  type CustomerNameListResponse,
  type CustomerSearchResponse,
} from '@erp/types';

import { Authenticated, RequireRoles } from '../auth/authz.decorators';
import type { AuthenticatedRequest } from '../auth/session.guard';
import { UuidParam } from '../params.decorators';

@Controller('crm/customers')
export class CrmController {
  constructor(@Inject(CustomerService) private readonly customers: CustomerService) {}

  @RequireRoles(...SALES_WRITE_ROLES)
  @Post()
  async create(@Body() body: unknown): Promise<Customer> {
    const parsed = createCustomerRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(refusalBody(parsed.error));
    }
    try {
      const created = await this.customers.create(parsed.data);
      return customerSchema.parse(created);
    } catch (err) {
      if (err instanceof DuplicateLegacyAccountNumberError) {
        throw new ConflictException({
          reason: 'duplicate-legacy-account-number',
          value: err.value,
        });
      }
      throw err;
    }
  }

  @Authenticated()
  @Get('names')
  async listNames(): Promise<CustomerNameListResponse> {
    const page = await this.customers.listNames(CUSTOMER_NAME_LIST_MAX);
    return customerNameListResponseSchema.parse(page);
  }

  @Authenticated()
  @Get(':id')
  async findById(@UuidParam('id') id: string): Promise<Customer> {
    const found = await this.customers.findById(id);
    if (found === null) {
      throw new NotFoundException();
    }
    return customerSchema.parse(found);
  }

  @RequireRoles(...SALES_WRITE_ROLES)
  @Patch(':id')
  async update(@UuidParam('id') id: string, @Body() body: unknown): Promise<Customer> {
    const parsed = updateCustomerRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(refusalBody(parsed.error));
    }
    try {
      const updated = await this.customers.update(id, parsed.data);
      if (updated === null) {
        throw new NotFoundException();
      }
      return customerSchema.parse(updated);
    } catch (err) {
      if (err instanceof DuplicateLegacyAccountNumberError) {
        throw new ConflictException({
          reason: 'duplicate-legacy-account-number',
          value: err.value,
        });
      }
      throw staleAsConflict(err);
    }
  }

  @RequireRoles(...CREDIT_HOLD_ROLES)
  @Put(':id/credit-hold')
  async setCreditHold(
    @UuidParam('id') id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<Customer> {
    if (request.erpUser === undefined) {
      throw new UnauthorizedException();
    }
    const parsed = setCreditHoldRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(refusalBody(parsed.error));
    }
    try {
      const updated = await this.customers.setCreditHold(
        id,
        parsed.data.held,
        // Who set or cleared the hold is recorded from the session.
        request.erpUser.username,
        parsed.data.lockVersion,
      );
      if (updated === null) {
        throw new NotFoundException();
      }
      return customerSchema.parse(updated);
    } catch (err) {
      throw staleAsConflict(err);
    }
  }

  @Authenticated()
  @Get()
  async search(@Query() query: unknown): Promise<CustomerSearchResponse> {
    const parsed = customerSearchQuerySchema.safeParse(query);
    if (!parsed.success) {
      throw new BadRequestException(refusalBody(parsed.error));
    }
    const page = await this.customers.search(parsed.data);
    return customerSearchResponseSchema.parse(page);
  }
}

function staleAsConflict(err: unknown): unknown {
  if (err instanceof StaleAggregateError) {
    return new ConflictException({
      reason: 'stale-aggregate',
      value: { expected: err.expected, actual: err.actual },
    });
  }
  return err;
}
