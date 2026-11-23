// The Admin section's users: search the directory and grant roles. Admin alone may do either: docs/product/roles.md.
// The service is `AdminRoleService` in modules/identity/src/admin-role-service.ts.
import { AdminRoleService, LdapUnreachableError } from '@erp/identity';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Put,
  Query,
  Req,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  ADMIN_SECTION_READ_ROLES,
  adminUserListResponseSchema,
  adminUserRowSchema,
  refusalBody,
  setRolesRequestSchema,
  setRolesResponseSchema,
  type AdminUserListResponse,
  type SetRolesResponse,
} from '@erp/types';

import { RequireRoles } from '../auth/authz.decorators';
import type { AuthenticatedRequest } from '../auth/session.guard';

@Controller('admin/users')
export class AdminController {
  constructor(@Inject(AdminRoleService) private readonly admin: AdminRoleService) {}

  @RequireRoles(...ADMIN_SECTION_READ_ROLES)
  @Get()
  async search(@Query('q') q: unknown): Promise<AdminUserListResponse> {
    const query = typeof q === 'string' ? q : '';
    try {
      const rows = await this.admin.searchUsers(query);
      return adminUserListResponseSchema.parse({ items: rows });
    } catch (error) {
      if (error instanceof LdapUnreachableError) {
        // The same reason word the sign-in route uses.
        throw new ServiceUnavailableException({ reason: 'directory-unreachable' });
      }
      throw error;
    }
  }

  @RequireRoles('Admin')
  @Put(':externalId/roles')
  async setRoles(
    // Not `UuidParam`: this is the directory's identifier, not a database id. apps/api/test/every-id-param-is-a-uuid.test.ts lists it.
    @Param('externalId') externalId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<SetRolesResponse> {
    const parsed = setRolesRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(refusalBody(parsed.error));
    }
    if (request.erpUser === undefined) {
      throw new UnauthorizedException();
    }

    const result = await this.admin.setRolesForUser(externalId, parsed.data, {
      actor: request.erpUser,
      ...(request.ip === undefined ? {} : { sourceIp: request.ip }),
    });
    if (!result.ok) {
      throw new BadRequestException({ reason: result.reason });
    }

    return setRolesResponseSchema.parse({
      user: adminUserRowSchema.parse({
        externalId: result.user.externalId,
        username: result.user.username,
        displayName: result.user.displayName,
        ...(result.user.email === undefined ? {} : { email: result.user.email }),
        roles: [...result.user.roles],
        alreadyProvisioned: true,
      }),
    });
  }
}
