// Answers an oversized upload with the page's own refusal instead of the framework's bare error.
// apps/web/src/middleware.ts calls `postTooLarge` on every request. A post over the body limit to a page with a file box
// is redirected back to that page with the refusal in its banner.
// apps/web/src/app/every-file-box-is-answered-over-50mb.test.ts fails when a page with a file box is missing from TOO_LARGE_PAGES.
import { LOAD_THE_RATES_FILE } from '../app/quoting/tax-rates/rates-body';
import { RECEIVED_DOCUMENT_MAX_MB } from './received-document';

const BYTES_PER_MB = 1024 * 1024;

// Must equal both body limits in apps/web/next.config.mjs. apps/web/src/lib/post-too-large.test.ts reads the config to hold them together.
export const POST_BODY_MAX_BYTES = 50 * BYTES_PER_MB;

const OVER_THE_LIMIT = `That file is over ${String(POST_BODY_MAX_BYTES / BYTES_PER_MB)} MB`;

export const ATTACH_TOO_LARGE = `${OVER_THE_LIMIT}, and the limit is ${String(RECEIVED_DOCUMENT_MAX_MB)} MB. Save a smaller copy and attach it again.`;

export const CREATE_ORDERS_TOO_LARGE = `No order was created. ${OVER_THE_LIMIT}, and the limit is ${String(RECEIVED_DOCUMENT_MAX_MB)} MB. Save a smaller copy, then fill in the boxes again and choose it.`;

export const RATES_TOO_LARGE = `${OVER_THE_LIMIT}, which is too large to be a rates file. ${LOAD_THE_RATES_FILE}`;

export interface TooLargePage {
  readonly shape: RegExp;
  readonly words: string;
  readonly field?: string;
}

export const TOO_LARGE_PAGES: readonly TooLargePage[] = [
  { shape: /^\/orders\/[^/\\]+$/, words: ATTACH_TOO_LARGE, field: 'documents' },

  { shape: /^\/quoting\/quotes\/[^/\\]+\/convert$/, words: CREATE_ORDERS_TOO_LARGE },

  { shape: /^\/quoting\/tax-rates$/, words: RATES_TOO_LARGE },
];

export function tooLargePageAt(pathname: string): TooLargePage | undefined {
  return TOO_LARGE_PAGES.find((page) => page.shape.test(pathname));
}

export interface IncomingPost {
  readonly method: string;

  readonly url: string;
  readonly contentLength: string | null;

  readonly fromAction: boolean;
}

export interface TooLargeAnswer {
  readonly status: 303;
  readonly headers: Readonly<Record<string, string>>;
}

function declaredBytes(contentLength: string | null): number | undefined {
  if (contentLength === null || !/^\d+$/.test(contentLength)) {
    return undefined;
  }
  return Number(contentLength);
}

export function postTooLarge(post: IncomingPost): TooLargeAnswer | undefined {
  if (post.method !== 'POST') {
    return undefined;
  }
  const declared = declaredBytes(post.contentLength);
  if (declared === undefined || declared <= POST_BODY_MAX_BYTES) {
    return undefined;
  }
  const request = new URL(post.url);
  const page = tooLargePageAt(request.pathname);
  if (page === undefined) {
    return undefined;
  }

  const field = page.field === undefined ? '' : `&field=${encodeURIComponent(page.field)}`;
  const landing = new URL(
    `${request.pathname}?error=${encodeURIComponent(page.words)}${field}`,
    request.origin,
  );
  // Fails closed. The landing is built from the request's own path, and must never become a redirect off this origin.
  if (landing.origin !== request.origin) {
    return undefined;
  }

  // A server action posted with JavaScript on follows `x-action-redirect`, not Location.
  if (post.fromAction) {
    return {
      status: 303,
      headers: {
        'content-type': 'text/plain',
        'x-action-redirect': `${landing.pathname}${landing.search};push`,
      },
    };
  }
  return { status: 303, headers: { location: landing.href } };
}
