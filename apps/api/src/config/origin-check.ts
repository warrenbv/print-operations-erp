// Refuses a write sent from a browser page on another origin, before the body or an upload is read.
// A write with no `Origin` header passes: the web app's server-side calls and non-browser clients send none, and the
// session and role guards still decide them. Applied through apps/api/src/config/request-parsing.ts, so every way the
// API is built carries it. Pinned by apps/api/test/origin-check.e2e.test.ts.
import { ForbiddenException } from '@nestjs/common';
import type { NextFunction, Request, RequestHandler, Response } from 'express';

const SAFE_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD', 'OPTIONS']);
const WEB_SCHEMES: ReadonlySet<string> = new Set(['http:', 'https:']);

/**
 * The web app's origin from `WEB_ORIGIN`, or `undefined` when it is unset or empty and no browser origin is allowed.
 * Throws at start on any other value that is not exactly an `http:` or `https:` origin as a browser sends it, with a
 * port other than 0, because it would never match and so refuse every browser write, or as `null` would admit pages
 * that have no origin of their own.
 */
export function configuredWebOrigin(env: NodeJS.ProcessEnv): string | undefined {
  const origin = env.WEB_ORIGIN;
  if (origin === undefined || origin === '') {
    return undefined;
  }
  const parsed = URL.canParse(origin) ? new URL(origin) : undefined;
  if (
    parsed === undefined ||
    parsed.origin !== origin ||
    !WEB_SCHEMES.has(parsed.protocol) ||
    parsed.port === '0'
  ) {
    throw new Error(
      `WEB_ORIGIN "${origin}" is not an origin: write the web app's http or https scheme, lower-case host and ` +
        'any non-default port other than 0, with no path and no trailing slash, such as https://erp.example.test',
    );
  }
  return origin;
}

// Compared as the exact string a browser sends (scheme, host and port), the same comparison the CORS setting in
// apps/api/src/main.ts makes. The literal `null` a sandboxed or opaque page sends never matches.
export function refuseForeignOriginWrites(webOrigin: string | undefined): RequestHandler {
  const refusal = new ForbiddenException({ reason: 'foreign-origin' });

  return (request: Request, response: Response, next: NextFunction) => {
    const origin = request.headers.origin;
    if (SAFE_METHODS.has(request.method) || origin === undefined || origin === webOrigin) {
      next();
      return;
    }
    response.status(refusal.getStatus()).json(refusal.getResponse());
  };
}
