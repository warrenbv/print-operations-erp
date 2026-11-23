// Runs before every page and server action except static assets.
// A post over the body limit to a page with a file box is sent back to that page with a message: apps/web/src/lib/post-too-large.ts.
// Every other request gets its path copied into `x-pathname`, because a layout is not given the request URL.
// The root layout, apps/web/src/lib/load-me.ts and apps/web/src/lib/fetch-parsed.ts read it.
import { NextResponse, type NextRequest } from 'next/server';

import { postTooLarge } from './lib/post-too-large';

export function middleware(request: NextRequest): NextResponse {
  const tooLarge = postTooLarge({
    method: request.method,
    url: request.url,
    contentLength: request.headers.get('content-length'),
    fromAction: request.headers.has('next-action'),
  });
  if (tooLarge !== undefined) {
    return new NextResponse(null, tooLarge);
  }

  const headers = new Headers(request.headers);
  headers.set('x-pathname', request.nextUrl.pathname);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
