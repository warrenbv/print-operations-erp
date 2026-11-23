// Reads the session token out of the API's sign-in reply, and turns a refused sign-in into words.
// The token is an opaque lookup key that only the API can resolve: docs/decisions/005-server-side-sessions.md.
export const SESSION_COOKIE = 'erp_session';

export const FAILURE_MESSAGES: Readonly<Record<string, string>> = {
  'invalid-credentials': 'That username and password did not match. Check both and try again.',
  'directory-unreachable':
    'The directory is not answering, so your password could not be checked. This is not a problem with your account — try again shortly, and tell IT if it persists.',
};

export const FALLBACK_MESSAGE =
  'Sign-in failed for an unexpected reason. Try again, and tell IT if it keeps happening.';

/**
 * Only a reason named in `FAILURE_MESSAGES` is shown. Any other reply gets the fallback,
 * so an unexpected reason from the API never reaches the screen.
 */
export function readableFailure(body: unknown): string {
  const reason =
    typeof body === 'object' && body !== null
      ? (body as Record<string, unknown>).reason
      : undefined;
  if (typeof reason === 'string') {
    const message = FAILURE_MESSAGES[reason];
    if (message !== undefined) return message;
  }
  return FALLBACK_MESSAGE;
}

export function sessionTokenFrom(setCookies: readonly string[]): string | undefined {
  for (const header of setCookies) {
    const [pair] = header.split(';');
    if (pair === undefined) continue;
    const separator = pair.indexOf('=');
    if (separator === -1) continue;
    if (pair.slice(0, separator).trim() !== SESSION_COOKIE) continue;
    const value = pair.slice(separator + 1).trim();
    if (value !== '') return value;
  }
  return undefined;
}
