// A customer's contacts. Sales and Admin edit them, and any signed-in user reads them.
// The contacts tagged for quotes are who a quote goes to: docs/product/requirements.md (R1). Service: modules/crm/src/services/contact-service.ts.
import { StaleAggregateError } from '@erp/db';
import { ContactCustomerNotFoundError, ContactService } from '@erp/crm';
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Patch,
  Post,
  Req,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  CONTACT_NEEDS_NAME_OR_EMAIL,
  contactListResponseSchema,
  contactSchema,
  createContactRequestSchema,
  deleteContactRequestSchema,
  refusalBody,
  updateContactRequestSchema,
  updateContactResponseSchema,
  SALES_WRITE_ROLES,
  type Contact,
  type ContactListResponse,
  type UpdateContactResponse,
} from '@erp/types';

import { Authenticated, RequireRoles } from '../auth/authz.decorators';
import type { AuthenticatedRequest } from '../auth/session.guard';
import { UuidParam } from '../params.decorators';

@Controller('crm/customers/:customerId/contacts')
export class CrmContactController {
  constructor(@Inject(ContactService) private readonly contacts: ContactService) {}

  @RequireRoles(...SALES_WRITE_ROLES)
  @Post()
  async create(
    @UuidParam('customerId') customerId: string,
    @Body() body: unknown,
  ): Promise<Contact> {
    const parsed = createContactRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(refusalBody(parsed.error));
    }
    try {
      const result = await this.contacts.create(customerId, parsed.data);
      if (!result.ok) {
        if (result.reason === 'contact-needs-name-or-email') {
          throw needsNameOrEmail();
        }

        throw new NotFoundException();
      }
      return contactSchema.parse(result.contact);
    } catch (err) {
      if (err instanceof ContactCustomerNotFoundError) {
        throw new NotFoundException();
      }
      throw err;
    }
  }

  @Authenticated()
  @Get()
  async list(@UuidParam('customerId') customerId: string): Promise<ContactListResponse> {
    const page = await this.contacts.listByCustomer(customerId);
    if (page === null) {
      throw new NotFoundException();
    }
    return contactListResponseSchema.parse(page);
  }

  @RequireRoles(...SALES_WRITE_ROLES)
  @Patch(':contactId')
  async update(
    @UuidParam('customerId') customerId: string,
    @UuidParam('contactId') contactId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<UpdateContactResponse> {
    if (request.erpUser === undefined) {
      throw new UnauthorizedException();
    }
    const parsed = updateContactRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(refusalBody(parsed.error));
    }
    let result;
    try {
      result = await this.contacts.update(
        customerId,
        contactId,
        parsed.data,
        // The editor is recorded from the session, never from the body.
        request.erpUser.username,
      );
    } catch (err) {
      throw staleAsConflict(err);
    }
    if (!result.ok) {
      // A contact cannot keep a tag it has no way to receive.
      if (result.reason === 'contact-role-unreachable') {
        throw new UnprocessableEntityException({
          reason: 'contact-role-unreachable',
          message: `that contact cannot hold ${result.roles.join(', ')}: a mail role needs an email address, and production needs a phone or an email.`,
        });
      }
      if (result.reason === 'contact-needs-name-or-email') {
        throw needsNameOrEmail();
      }

      throw new NotFoundException();
    }
    return updateContactResponseSchema.parse({
      ...result.contact,
      rolesGivenUp: result.rolesGivenUp,
    });
  }

  @RequireRoles(...SALES_WRITE_ROLES)
  @Delete(':contactId')
  @HttpCode(204)
  async delete(
    @UuidParam('customerId') customerId: string,
    @UuidParam('contactId') contactId: string,
    @Body() body: unknown,
  ): Promise<void> {
    const parsed = deleteContactRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(refusalBody(parsed.error));
    }
    let result;
    try {
      result = await this.contacts.delete(customerId, contactId, parsed.data.lockVersion);
    } catch (err) {
      throw staleAsConflict(err);
    }
    if (!result.ok) {
      throw new NotFoundException();
    }
  }
}

function needsNameOrEmail(): BadRequestException {
  return new BadRequestException({
    reason: 'contact-needs-name-or-email',
    message: CONTACT_NEEDS_NAME_OR_EMAIL,
  });
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
