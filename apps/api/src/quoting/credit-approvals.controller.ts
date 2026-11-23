// Credit-hold exceptions. Sales asks, and `CREDIT_HOLD_ROLES` (packages/types/src/roles.ts) decide:
// docs/product/requirements.md (R2).
// Asking is open to any signed-in user. The rules are in modules/quoting/src/services/quote-service.ts.
import {
  CustomerNotOnCreditHoldError,
  QuoteApprovalAlreadyDecidedError,
  QuoteService,
  UnknownCustomerError,
  UnspentQuoteApprovalExistsError,
} from '@erp/quoting';
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Post,
  Query,
  Req,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  CREDIT_HOLD_ROLES,
  decideQuoteApprovalSchema,
  quoteApprovalListResponseSchema,
  quoteApprovalSchema,
  refusalBody,
  requestQuoteApprovalSchema,
  type QuoteApproval,
  type QuoteApprovalListResponse,
} from '@erp/types';

import { Authenticated, RequireRoles } from '../auth/authz.decorators';
import type { AuthenticatedRequest } from '../auth/session.guard';
import { UuidParam } from '../params.decorators';

@Controller('quoting/credit-approvals')
export class CreditApprovalsController {
  constructor(@Inject(QuoteService) private readonly quotes: QuoteService) {}

  @Authenticated()
  @Post()
  async request(
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<QuoteApproval> {
    if (request.erpUser === undefined) {
      throw new UnauthorizedException();
    }
    const parsed = requestQuoteApprovalSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(refusalBody(parsed.error));
    }
    try {
      const created = await this.quotes.requestApproval(parsed.data.customerId, {
        reason: parsed.data.reason,

        requestedBy: request.erpUser.username,
      });
      return quoteApprovalSchema.parse(created);
    } catch (err) {
      throw mapApprovalError(err);
    }
  }

  @Authenticated()
  @Get()
  async listPending(@Query('customerId') customerId: unknown): Promise<QuoteApprovalListResponse> {
    let customerIdFilter: string | undefined;
    if (customerId !== undefined) {
      if (typeof customerId !== 'string') {
        throw new BadRequestException({ reason: 'invalid-customer-id' });
      }
      if (customerId === '') {
        throw new BadRequestException({ reason: 'empty-customer-id' });
      }
      customerIdFilter = customerId;
    }
    const items =
      customerIdFilter === undefined
        ? await this.quotes.listPendingApprovals()
        : await this.quotes.listApprovalsForCustomer(customerIdFilter);
    return quoteApprovalListResponseSchema.parse({ items });
  }

  @RequireRoles(...CREDIT_HOLD_ROLES)
  @Post(':id/decision')
  async decide(
    @UuidParam('id') id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<QuoteApproval> {
    if (request.erpUser === undefined) {
      throw new UnauthorizedException();
    }
    const parsed = decideQuoteApprovalSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(refusalBody(parsed.error));
    }
    try {
      const decided = await this.quotes.decideApproval(id, {
        decision: parsed.data.decision,
        decidedBy: request.erpUser.username,
        ...(parsed.data.decision === 'rejected' ? { reason: parsed.data.reason } : {}),
      });
      if (decided === null) {
        throw new NotFoundException();
      }
      return quoteApprovalSchema.parse(decided);
    } catch (err) {
      throw mapApprovalError(err);
    }
  }
}

function mapApprovalError(err: unknown): unknown {
  if (err instanceof UnknownCustomerError) {
    return new UnprocessableEntityException({ reason: 'unknown-customer', value: err.customerId });
  }
  // One approval permits exactly one quote, so no exception is granted without a hold or beside an unspent one:
  // docs/product/requirements.md (R2).
  if (err instanceof CustomerNotOnCreditHoldError) {
    return new ConflictException({
      reason: 'customer-not-on-credit-hold',
      value: err.customerId,
      message: err.message,
    });
  }
  if (err instanceof UnspentQuoteApprovalExistsError) {
    return new ConflictException({
      reason: 'unspent-approval-exists',
      value: err.customerId,
      message: err.message,
    });
  }
  if (err instanceof QuoteApprovalAlreadyDecidedError) {
    return new ConflictException({
      reason: 'approval-already-decided',
      value: err.status,
    });
  }
  return err;
}
