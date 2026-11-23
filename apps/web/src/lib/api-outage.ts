// What the web app says when the API is down or failing, and which routes must still render then.
// apps/web/src/lib/load-me.ts sends every other page to apps/web/src/app/api-unavailable/page.tsx.
export type OutageOutcome =
  { kind: 'no-answer'; cause: unknown } | { kind: 'error-status'; status: number };

// /login stays reachable so the way back in is never hidden, and /api-unavailable must not redirect to itself.
export function survivesOutage(pathname: string): boolean {
  return pathname === '/login' || pathname === '/api-unavailable';
}

export interface OutageNotice {
  readonly heading: string;
  readonly detail: string;
}

export function outageNotice(outcome: OutageOutcome, baseUrl: string): OutageNotice {
  if (outcome.kind === 'no-answer') {
    return {
      heading: 'The API is unavailable',
      detail: `Nothing answered at ${baseUrl}. This page cannot load until the API is back. Try again in a moment.`,
    };
  }
  return {
    heading: 'The API is not serving requests',
    detail: `${baseUrl} answered ${outcome.status}. The API is running but cannot serve this page. Try again in a moment.`,
  };
}

/**
 * The path a retry or return link may point to. Anything but a same-site path, a protocol-relative
 * `//host` or `/\host` included, becomes `/`, so the link cannot send the reader off the site.
 */
export function safeReturnPath(from: string | undefined): string {
  if (from === undefined || from === '') return '/';
  if (!from.startsWith('/')) return '/';
  if (from.startsWith('//') || from.startsWith('/\\')) return '/';
  return from;
}
