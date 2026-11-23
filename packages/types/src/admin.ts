// The Admin section's shapes: directory users with their roles, and the role catalogue with recent failed alerts.
// Only Admin reads them, through `ADMIN_SECTION_READ_ROLES` in packages/types/src/roles.ts.
// The API side: apps/api/src/admin/admin.controller.ts.
import { z } from 'zod';

import { erpRoleSchema, ERP_ROLES } from './roles';
import { sendFailureReasonSchema, sendSubjectTypeSchema } from './send-log';

export const adminUserRowSchema = z.object({
  externalId: z.string().min(1),
  username: z.string().min(1),
  displayName: z.string().min(1),
  email: z.email().optional(),

  disabled: z.boolean().optional(),
  roles: z.array(erpRoleSchema),

  alreadyProvisioned: z.boolean(),
});

export type AdminUserRow = z.infer<typeof adminUserRowSchema>;

export const adminUserListResponseSchema = z.object({
  items: z.array(adminUserRowSchema),
});

export type AdminUserListResponse = z.infer<typeof adminUserListResponseSchema>;

export const setRolesRequestSchema = z.object({
  identity: z.object({
    externalId: z.string().min(1),
    username: z.string().trim().toLowerCase().min(1),
    displayName: z.string().min(1),
    email: z.email().optional(),
  }),

  roles: z.array(erpRoleSchema).max(ERP_ROLES.length),
});

export type SetRolesRequest = z.infer<typeof setRolesRequestSchema>;

export const setRolesResponseSchema = z.object({
  user: adminUserRowSchema,
});

export type SetRolesResponse = z.infer<typeof setRolesResponseSchema>;

export const roleHolderSchema = z.object({
  externalId: z.string().min(1),
  username: z.string().min(1),
  displayName: z.string().min(1),

  email: z.email().optional(),
});

export type RoleHolder = z.infer<typeof roleHolderSchema>;

export const roleHoldersSchema = z.object({
  role: erpRoleSchema,
  holders: z.array(roleHolderSchema),
});

export type RoleHolders = z.infer<typeof roleHoldersSchema>;

export const alertFailureSummarySchema = z.object({
  windowDays: z.number().int().positive(),
  count: z.number().int().nonnegative(),

  latest: z
    .object({
      subjectType: sendSubjectTypeSchema,
      subjectId: z.string().min(1),
      reason: sendFailureReasonSchema,

      at: z.iso.datetime(),
    })
    .optional(),
});

export type AlertFailureSummary = z.infer<typeof alertFailureSummarySchema>;

export const roleCatalogResponseSchema = z.object({
  items: z.array(roleHoldersSchema),
  failedAlerts: alertFailureSummarySchema,
});

export type RoleCatalogResponse = z.infer<typeof roleCatalogResponseSchema>;
