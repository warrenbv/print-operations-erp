// Sign-in contracts: the login request and reply, the identity a directory returns, and the signed-in user.
// `AuthProvider` is the port each sign-in source implements: modules/identity/src/providers/.
// The session behind a signed-in user is server-side: docs/decisions/005-server-side-sessions.md.
import { z } from 'zod';

import { erpRoleSchema } from './roles';

export const loginRequestSchema = z.object({
  username: z.string().trim().toLowerCase().min(1),
  password: z.string().min(1),
});

export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const verifiedIdentitySchema = z.object({
  externalId: z.string().min(1),

  username: z.string().min(1),
  displayName: z.string().min(1),
  email: z.email().optional(),
});

export type VerifiedIdentity = z.infer<typeof verifiedIdentitySchema>;

export const AUTH_FAILURE_REASONS = ['invalid-credentials', 'directory-unreachable'] as const;

export type AuthFailureReason = (typeof AUTH_FAILURE_REASONS)[number];

export type AuthResult =
  { ok: true; identity: VerifiedIdentity } | { ok: false; reason: AuthFailureReason };

export interface AuthProvider {
  authenticate(username: string, password: string): Promise<AuthResult>;
}

export const sessionUserSchema = z.object({
  id: z.string().min(1),
  username: z.string().min(1),
  displayName: z.string().min(1),
  email: z.email().optional(),

  roles: z.array(erpRoleSchema),
});

export type SessionUser = z.infer<typeof sessionUserSchema>;

export const loginResponseSchema = z.object({
  user: sessionUserSchema,

  expiresAt: z.iso.datetime(),
});

export type LoginResponse = z.infer<typeof loginResponseSchema>;

export const loginErrorSchema = z.object({
  reason: z.enum(AUTH_FAILURE_REASONS),
});

export type LoginError = z.infer<typeof loginErrorSchema>;
