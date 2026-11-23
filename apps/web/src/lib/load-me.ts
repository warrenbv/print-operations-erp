// Loads the signed-in user by asking the API's /auth/me with the session cookie: docs/decisions/005-server-side-sessions.md.
// Roles come back on every read, so a role change shows on the next page load.
// When the API is down, every page but the outage-safe ones goes to /api-unavailable: apps/web/src/lib/api-outage.ts.
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { sessionUserSchema, type SessionUser } from '@erp/types';

import { apiFetch } from './api-fetch';
import { survivesOutage, type OutageOutcome } from './api-outage';

export type SessionOutcome =
  { kind: 'signed-in'; me: SessionUser } | { kind: 'signed-out' } | OutageOutcome;

/**
 * The session read as an outcome that never throws or redirects, for a caller that must render whatever
 * happens, such as the layout. Pages use `loadMe`.
 */
export async function loadSessionOutcome(): Promise<SessionOutcome> {
  let response: Response;
  try {
    response = await apiFetch('/auth/me');
  } catch (cause) {
    return { kind: 'no-answer', cause };
  }
  if (response.status === 401) {
    return { kind: 'signed-out' };
  }
  if (!response.ok) {
    return { kind: 'error-status', status: response.status };
  }
  return { kind: 'signed-in', me: sessionUserSchema.parse(await response.json()) };
}

export async function loadMe(): Promise<SessionUser | null> {
  const outcome = await loadSessionOutcome();
  switch (outcome.kind) {
    case 'signed-in':
      return outcome.me;
    case 'signed-out':
      return null;
    case 'no-answer':
      return leaveForOutageRoute(new Error('/auth/me did not answer', { cause: outcome.cause }));
    case 'error-status':
      return leaveForOutageRoute(new Error(`/auth/me responded ${outcome.status}`));
  }
}

async function leaveForOutageRoute(reported: Error): Promise<never> {
  const pathname = (await headers()).get('x-pathname') ?? '/';
  // The outage-safe routes must not redirect, so there the error is thrown to the error boundary.
  if (survivesOutage(pathname)) {
    throw reported;
  }

  console.warn(`session read failed on ${pathname}:`, reported);
  redirect(`/api-unavailable?from=${encodeURIComponent(pathname)}`);
}
