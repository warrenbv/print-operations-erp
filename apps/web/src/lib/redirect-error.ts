// Sends a server action back to a page with a message for its banner, as `?error=` or `?notice=`.
// The page renders the banner on the server, the pattern of docs/decisions/004-server-first-web-ui.md.
// The message itself usually comes from apps/web/src/lib/api-error.ts.
import { redirect } from 'next/navigation';

function messageUrl(
  path: string,
  channel: 'error' | 'notice',
  message: string,
  extra: Readonly<Record<string, string>>,
): string {
  const tail = Object.entries(extra)
    .map(([key, value]) => `&${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('');
  return `${path}?${channel}=${encodeURIComponent(message)}${tail}`;
}

// `path` is used as given, so the caller encodes any id in it. `extra` entries are encoded here.
export function errorUrl(
  path: string,
  message: string,
  extra: Readonly<Record<string, string>> = {},
): string {
  return messageUrl(path, 'error', message, extra);
}

export function noticeUrl(
  path: string,
  message: string,
  extra: Readonly<Record<string, string>> = {},
): string {
  return messageUrl(path, 'notice', message, extra);
}

/**
 * Redirects to `path` with the message and never returns. `redirect` works by throwing, so do not call this
 * inside a try block that catches everything.
 */
export function backWithError(
  path: string,
  message: string,
  extra: Readonly<Record<string, string>> = {},
): never {
  redirect(errorUrl(path, message, extra));
}
