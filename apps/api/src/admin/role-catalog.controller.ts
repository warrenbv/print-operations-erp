// The role catalogue for the Admin section: who holds each role, and the internal alerts that failed in a recent window.
// An alert addressed to a role fails when nobody holds it or no holder has an email address, which is fixed on the users screen.
import { AdminRoleService } from '@erp/identity';
import type { SendLog } from '@erp/notifications';
import { Controller, Get, Inject } from '@nestjs/common';
import {
  ADMIN_SECTION_READ_ROLES,
  roleCatalogResponseSchema,
  type RoleCatalogResponse,
} from '@erp/types';

import { RequireRoles } from '../auth/authz.decorators';
import { SEND_LOG } from '../notifications/notifications.factory';
import { apiClock } from '../test-clock';

const FAILED_ALERT_WINDOW_DAYS = 30;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

@Controller('admin/roles')
export class RoleCatalogController {
  constructor(
    @Inject(AdminRoleService) private readonly admin: AdminRoleService,
    @Inject(SEND_LOG) private readonly sendLog: SendLog,
  ) {}

  @RequireRoles(...ADMIN_SECTION_READ_ROLES)
  @Get()
  async catalog(): Promise<RoleCatalogResponse> {
    const since = new Date(apiClock.now().getTime() - FAILED_ALERT_WINDOW_DAYS * MS_PER_DAY);
    const [items, failed] = await Promise.all([
      this.admin.listRoleHolders(),
      this.sendLog.failedInternalAlertsSince(since),
    ]);

    const latest =
      failed.latest === undefined || failed.latest.failureReason === undefined
        ? undefined
        : {
            subjectType: failed.latest.subject.type,
            subjectId: failed.latest.subject.id,
            reason: failed.latest.failureReason,
            at: failed.latest.submittedAt.toISOString(),
          };

    return roleCatalogResponseSchema.parse({
      items,
      failedAlerts: {
        windowDays: FAILED_ALERT_WINDOW_DAYS,
        count: failed.count,
        ...(latest === undefined ? {} : { latest }),
      },
    });
  }
}
