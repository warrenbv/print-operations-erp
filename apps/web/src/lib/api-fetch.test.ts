// Tests which of the browser's cookies a server-side call to the API carries: the session cookie and nothing else.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const jar = vi.hoisted(() => ({ cookies: [] as { name: string; value: string }[] }));

vi.mock('next/headers', () => ({
  cookies: () =>
    Promise.resolve({
      get: (name: string) => jar.cookies.find((cookie) => cookie.name === name),
      getAll: () => [...jar.cookies],
    }),
}));

const { apiFetch } = await import('./api-fetch');
const { SESSION_COOKIE } = await import('../app/login/session-cookie');

const fetchSpy = vi.fn<typeof fetch>();

function sentHeaders(): Headers {
  const init = fetchSpy.mock.calls[0]?.[1];
  return new Headers(init?.headers);
}

beforeEach(() => {
  fetchSpy.mockResolvedValue(new Response('{}', { status: 200 }));
  vi.stubGlobal('fetch', fetchSpy);
});

afterEach(() => {
  vi.unstubAllGlobals();
  fetchSpy.mockReset();
  jar.cookies = [];
});

describe('the cookies a call to the API carries', () => {
  it('sends exactly the session cookie when the browser holds others beside it', async () => {
    jar.cookies = [
      { name: 'theme', value: 'dark' },
      { name: SESSION_COOKIE, value: 'sess-4qk2' },
      { name: 'proxy_affinity', value: 'node-b' },
    ];

    await apiFetch('/orders');

    expect(sentHeaders().get('Cookie')).toBe(`${SESSION_COOKIE}=sess-4qk2`);
  });

  it('does not forward a cookie whose name only starts or ends with the session name', async () => {
    jar.cookies = [
      { name: `${SESSION_COOKIE}_shadow`, value: 'planted-1' },
      { name: `other_${SESSION_COOKIE}`, value: 'planted-2' },
    ];

    await apiFetch('/orders', { method: 'POST', body: '{}' });

    expect(sentHeaders().has('Cookie')).toBe(false);
  });

  it('sends no Cookie header when there is no session cookie', async () => {
    jar.cookies = [{ name: 'theme', value: 'light' }];

    await apiFetch('/auth/me');

    expect(sentHeaders().has('Cookie')).toBe(false);
  });

  it('sends no Cookie header when the browser holds no cookies at all', async () => {
    await apiFetch('/auth/me');

    expect(sentHeaders().has('Cookie')).toBe(false);
  });

  it('keeps the session cookie on a multipart upload', async () => {
    jar.cookies = [
      { name: SESSION_COOKIE, value: 'sess-9mv1' },
      { name: 'tracking', value: 'abc' },
    ];

    await apiFetch('/orders/x/purchase-order/document', {
      method: 'POST',
      body: new FormData(),
    });

    expect(sentHeaders().get('Cookie')).toBe(`${SESSION_COOKIE}=sess-9mv1`);
    expect(sentHeaders().has('Content-Type')).toBe(false);
  });
});
