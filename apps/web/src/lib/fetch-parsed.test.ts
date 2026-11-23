// Tests the typed API read: its handling of 404, 403 and 503, and that logs and errors never carry the query.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  fetch: vi.fn<(path: string) => Promise<Response>>(),
}));
const nav = vi.hoisted(() => ({
  redirect: vi.fn<(to: string) => never>(),
}));

vi.mock('./api-fetch', () => ({ apiFetch: (path: string) => api.fetch(path) }));
vi.mock('next/headers', () => ({
  headers: () => Promise.resolve(new Headers({ 'x-pathname': '/' })),
}));
vi.mock('next/navigation', () => ({ redirect: (to: string) => nav.redirect(to) }));

const { fetchParsed } = await import('./fetch-parsed');

const schema = {
  parse(input: unknown): { items: unknown[] } {
    const { items } = input as { items?: unknown };
    if (!Array.isArray(items)) throw new Error('bad body');
    return { items };
  },
};

const PATH = '/orders';

const SEARCH = '/crm/customers?q=ZZ%20TEST%20Paper&limit=20&offset=0';

const TYPED = ['ZZ%20TEST%20Paper', 'ZZ TEST Paper'];

function warned(): string {
  return vi
    .mocked(console.warn)
    .mock.calls.map((args) => args.map(String).join(' '))
    .join('\n');
}

function expectNoQuery(text: string): void {
  for (const term of TYPED) expect(text).not.toContain(term);
  expect(text).not.toMatch(/[?]|%3f/i);
}

function answer(status: number, body: unknown = {}): void {
  api.fetch.mockResolvedValue(new Response(JSON.stringify(body), { status }));
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  nav.redirect.mockImplementation((to: string) => {
    throw new Error(`NEXT_REDIRECT ${to}`);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  api.fetch.mockReset();
  nav.redirect.mockReset();
});

describe('fetchParsed', () => {
  it('parses an OK answer', async () => {
    answer(200, { items: [1] });
    await expect(fetchParsed(PATH, schema)).resolves.toEqual({ items: [1] });
  });

  it('sends a refused read to /forbidden by default', async () => {
    answer(403);
    await expect(fetchParsed(PATH, schema)).rejects.toThrow('NEXT_REDIRECT /forbidden?from=%2F');
    expect(console.warn).toHaveBeenCalledWith('refused: /orders responded 403');
  });

  it("answers null for a refused read with forbidden: 'null', and still logs the path", async () => {
    answer(403);
    await expect(fetchParsed(PATH, schema, { forbidden: 'null' })).resolves.toBeNull();
    expect(nav.redirect).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledWith('refused: /orders responded 403');
  });

  it("still throws on any other failure with forbidden: 'null'", async () => {
    answer(500);
    await expect(fetchParsed(PATH, schema, { forbidden: 'null' })).rejects.toThrow(
      '/orders responded 500',
    );
  });

  it("answers null for a 404 with notFound: 'null' and a 503 with serviceUnavailable: 'null'", async () => {
    answer(404);
    await expect(fetchParsed(PATH, schema, { notFound: 'null' })).resolves.toBeNull();
    answer(503);
    await expect(fetchParsed(PATH, schema, { serviceUnavailable: 'null' })).resolves.toBeNull();
  });
});

describe('fetchParsed prints the path and never the query', () => {
  it('on the 503 line', async () => {
    answer(503);
    await expect(fetchParsed(SEARCH, schema, { serviceUnavailable: 'null' })).resolves.toBeNull();
    expect(console.warn).toHaveBeenCalledWith('unavailable: /crm/customers responded 503');
    expectNoQuery(warned());
  });

  it('on the 403 line', async () => {
    answer(403);
    await expect(fetchParsed(SEARCH, schema)).rejects.toThrow('NEXT_REDIRECT /forbidden?from=%2F');
    expect(console.warn).toHaveBeenCalledWith('refused: /crm/customers responded 403');
    expectNoQuery(warned());
  });

  it('in the error it throws on any other failure', async () => {
    answer(500);
    const thrown = await fetchParsed(SEARCH, schema).catch((error: unknown) => error);
    expect(thrown).toBeInstanceOf(Error);
    const { message } = thrown as Error;
    expect(message).toBe('/crm/customers responded 500');
    expectNoQuery(message);
    expectNoQuery(warned());
  });
});
