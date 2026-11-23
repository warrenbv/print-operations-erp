// Signs in with a username and password. The API checks them and issues the session.
// The web application keeps the API's session token in its own httpOnly cookie and forwards it on every
// API call: docs/decisions/005-server-side-sessions.md and apps/web/src/lib/api-fetch.ts.
'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { API_SERVER_URL } from '../../lib/api-fetch';
import { backWithError } from '../../lib/redirect-error';
import { SESSION_COOKIE, readableFailure, sessionTokenFrom } from './session-cookie';

export async function signInAction(formData: FormData): Promise<void> {
  const username = String(formData.get('username') ?? '').trim();
  const password = String(formData.get('password') ?? '');

  if (username === '' || password === '') {
    backWithError('/login', 'Enter your username and password.');
  }

  let response: Response;
  try {
    response = await fetch(`${API_SERVER_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
      cache: 'no-store',
    });
  } catch {
    backWithError('/login', 'Could not reach the API. Check that it is running, and tell IT.');
  }

  if (!response.ok) {
    backWithError('/login', readableFailure(await safeJson(response)));
  }

  const token = sessionTokenFrom(response.headers.getSetCookie());
  if (token === undefined) {
    backWithError('/login', 'Signed in, but the API issued no session. Tell IT.');
  }

  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    // The demo serves plain HTTP on the local machine, so its launcher sets SESSION_COOKIE_INSECURE
    // (scripts/demo-config.mjs). Unless that setting is true, the cookie is Secure.
    secure: process.env.SESSION_COOKIE_INSECURE !== 'true',
    path: '/',
  });

  redirect('/');
}

async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}
