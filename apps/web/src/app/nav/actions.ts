// The two acts in the top bar: signing out and choosing a theme.
// Signing out ends the session at the API and deletes the cookie: docs/decisions/005-server-side-sessions.md.
'use server';

import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { apiFetch } from '../../lib/api-fetch';
import { THEME_COOKIE, THEME_COOKIE_MAX_AGE_SECONDS, isTheme } from '../../lib/theme';
import { SESSION_COOKIE } from '../login/session-cookie';

export async function signOutAction(): Promise<void> {
  try {
    await apiFetch('/auth/logout', { method: 'POST' });
  } catch {
    // The cookie is deleted whether or not the API answered, so signing out always works here.
  }
  (await cookies()).delete(SESSION_COOKIE);
  redirect('/login');
}

export async function setThemeAction(formData: FormData): Promise<void> {
  const requested = formData.get('theme');
  const store = await cookies();
  if (requested === 'system') {
    store.delete(THEME_COOKIE);
  } else if (isTheme(requested)) {
    store.set(THEME_COOKIE, requested, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.SESSION_COOKIE_INSECURE !== 'true',
      path: '/',
      maxAge: THEME_COOKIE_MAX_AGE_SECONDS,
    });
  }
  redirect((await headers()).get('x-pathname') ?? '/');
}
