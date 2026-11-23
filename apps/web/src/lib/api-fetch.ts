// How server code calls the API with the person's session. It forwards the session cookie and no other, so the API
// sees the signed-in session (docs/decisions/005-server-side-sessions.md), and it never caches
// (docs/decisions/004-server-first-web-ui.md). The two calls that need no session, sign-in in
// apps/web/src/app/login/actions.ts and the health line in apps/web/src/lib/api-health.tsx, use `fetch` with no cookie.
// Server-only, because it reads the request's cookies. Typed reads go through apps/web/src/lib/fetch-parsed.ts.
import { cookies } from 'next/headers';

import { SESSION_COOKIE } from '../app/login/session-cookie';

export const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001';

// The server may reach the API at an internal address that differs from the public one.
// The demo launcher sets both: scripts/demo-config.mjs.
export const API_SERVER_URL = process.env.API_INTERNAL_URL ?? API_BASE_URL;

// Any other cookie set for this host, by another application or a proxy, stays out of the call.
async function sessionCookieHeader(): Promise<string | undefined> {
  const session = (await cookies()).get(SESSION_COOKIE);
  return session === undefined || session.value === ''
    ? undefined
    : `${SESSION_COOKIE}=${session.value}`;
}

export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const cookie = await sessionCookieHeader();
  if (cookie === undefined) {
    headers.delete('Cookie');
  } else {
    headers.set('Cookie', cookie);
  }

  // A FormData body gets its multipart Content-Type, boundary included, from fetch itself.
  if (init.body !== undefined && !headers.has('Content-Type') && !(init.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }
  return fetch(`${API_SERVER_URL}${path}`, {
    ...init,
    headers,
    cache: 'no-store',
  });
}
