// Reads from the API and parses the answer with a shared schema, so a page gets a typed value or a clear failure.
// A 403 sends the reader to /forbidden by default. The options turn a 404, 503 or 403 into `null` for a page that shows its own message.
// Log lines and errors carry the path without its query: apps/web/src/lib/path-for-log.ts.
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { apiFetch } from './api-fetch';
import { pathForLog } from './path-for-log';

// The request path, which apps/web/src/middleware.ts copies into `x-pathname`.
async function currentPathname(): Promise<string> {
  return (await headers()).get('x-pathname') ?? '/';
}

interface ParseSchema<T> {
  parse(input: unknown): T;
}

export async function fetchParsed<T>(path: string, schema: ParseSchema<T>): Promise<T>;
export async function fetchParsed<T>(
  path: string,
  schema: ParseSchema<T>,
  opts: { notFound: 'null' },
): Promise<T | null>;
export async function fetchParsed<T>(
  path: string,
  schema: ParseSchema<T>,
  opts: { serviceUnavailable: 'null' },
): Promise<T | null>;
export async function fetchParsed<T>(
  path: string,
  schema: ParseSchema<T>,
  opts: { forbidden: 'null' },
): Promise<T | null>;
export async function fetchParsed<T>(
  path: string,
  schema: ParseSchema<T>,
  opts: { notFound?: 'null'; serviceUnavailable?: 'null'; forbidden?: 'null' } = {},
): Promise<T | null> {
  const response = await apiFetch(path);
  if (opts.notFound === 'null' && response.status === 404) {
    return null;
  }
  if (opts.serviceUnavailable === 'null' && response.status === 503) {
    console.warn(`unavailable: ${pathForLog(path)} responded 503`);
    return null;
  }
  if (response.status === 403) {
    // Logged even when the caller asked for null, so a refused read is never silent.
    console.warn(`refused: ${pathForLog(path)} responded 403`);
    if (opts.forbidden === 'null') return null;
    redirect(`/forbidden?from=${encodeURIComponent(await currentPathname())}`);
  }
  if (!response.ok) {
    throw new Error(`${pathForLog(path)} responded ${response.status}`);
  }
  return schema.parse(await response.json());
}
