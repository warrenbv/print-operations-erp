// Tests the oversized-post answer: which posts it catches, where it redirects, and its words.
// It also reads apps/web/next.config.mjs, so the limit here and the framework's body limits cannot drift apart.
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import nextConfig from '../../next.config.mjs';
import { ratesBody } from '../app/quoting/tax-rates/rates-body';
import {
  ATTACH_TOO_LARGE,
  CREATE_ORDERS_TOO_LARGE,
  POST_BODY_MAX_BYTES,
  RATES_TOO_LARGE,
  TOO_LARGE_PAGES,
  postTooLarge,
  type IncomingPost,
} from './post-too-large';
import { receivedDocumentTooLarge } from './received-document';
import { errorUrl } from './redirect-error';

const MB = 1024 * 1024;

const ORIGIN = 'http://localhost:5813';

const ID = '0198a000-0000-7000-8000-000000000841';

function post(path: string, overrides: Partial<IncomingPost> = {}): IncomingPost {
  return {
    method: 'POST',
    url: `${ORIGIN}${path}`,
    contentLength: String(POST_BODY_MAX_BYTES + 1),
    fromAction: false,
    ...overrides,
  };
}

const PAGES = [
  { path: `/orders/${ID}`, words: ATTACH_TOO_LARGE, extra: { field: 'documents' } },
  { path: `/quoting/quotes/${ID}/convert`, words: CREATE_ORDERS_TOO_LARGE, extra: {} },
  { path: '/quoting/tax-rates', words: RATES_TOO_LARGE, extra: {} },
] as const;

describe('postTooLarge', () => {
  it('answers a post one byte over the limit, and lets one at the limit through', () => {
    const at = String(POST_BODY_MAX_BYTES);
    expect(postTooLarge(post(`/orders/${ID}`, { contentLength: at }))).toBeUndefined();
    expect(postTooLarge(post(`/orders/${ID}`))).toBeDefined();

    expect(postTooLarge(post(`/orders/${ID}`, { contentLength: String(51 * MB) }))).toBeDefined();
  });

  it('with JavaScript off, sends the browser to the page itself with a Location on our origin', () => {
    expect(postTooLarge(post(`/orders/${ID}`))).toEqual({
      status: 303,
      headers: {
        location: `${ORIGIN}/orders/${ID}?error=${encodeURIComponent(ATTACH_TOO_LARGE)}&field=documents`,
      },
    });
  });

  it('with JavaScript on, answers with no Location and the header Next reads instead', () => {
    expect(postTooLarge(post(`/orders/${ID}`, { fromAction: true }))).toEqual({
      status: 303,
      headers: {
        'content-type': 'text/plain',
        'x-action-redirect': `/orders/${ID}?error=${encodeURIComponent(ATTACH_TOO_LARGE)}&field=documents;push`,
      },
    });
  });

  it('gives each page its own words, built as the page builds its own refusal', () => {
    expect(TOO_LARGE_PAGES).toHaveLength(PAGES.length);
    for (const { path, words, extra } of PAGES) {
      const landing = errorUrl(path, words, extra);
      expect(postTooLarge(post(path))?.headers, path).toEqual({ location: `${ORIGIN}${landing}` });
      expect(
        postTooLarge(post(path, { fromAction: true }))?.headers['x-action-redirect'],
        path,
      ).toBe(`${landing};push`);
    }
  });

  it('leaves a GET, a PUT and any method but POST alone, however large', () => {
    for (const method of ['GET', 'HEAD', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'post']) {
      expect(postTooLarge(post(`/orders/${ID}`, { method })), method).toBeUndefined();
    }
  });

  it('leaves a post with no usable Content-Length alone, as Next has it today', () => {
    const over = String(POST_BODY_MAX_BYTES + 1);
    for (const contentLength of [
      null,
      '',
      'abc',
      `${over}abc`,
      `-${over}`,
      '6.1e7',
      `${over}.0`,
      `${over}, ${over}`,
      ` ${over}`,
    ]) {
      expect(
        postTooLarge(post(`/orders/${ID}`, { contentLength })),
        String(contentLength),
      ).toBeUndefined();
    }
  });

  it('leaves every path without a file box alone, because each page draws its own banner', () => {
    for (const path of [
      '/',
      '/orders',
      `/orders/${ID}/delivery`,
      `/orders/${ID}/amend`,
      `/orders/${ID}/`,
      `/quoting/quotes/${ID}`,
      '/quoting/quotes/new',
      `/quoting/quotes/${ID}/convert/x`,
      '/quoting/tax-rates/WA-0202',
      '/crm/customers',
      '/login',
    ]) {
      expect(postTooLarge(post(path)), path).toBeUndefined();
      expect(postTooLarge(post(path, { fromAction: true })), path).toBeUndefined();
    }
  });

  it("carries none of the request's own query", () => {
    const answer = postTooLarge(
      post(
        `/orders/${ID}?field=lines&q=ZZ%20Made-up%20Co&error=forged&next=https%3A%2F%2Fx.example`,
      ),
    );
    const location = new URL(answer?.headers.location ?? '');
    expect([...location.searchParams.keys()]).toEqual(['error', 'field']);
    expect(location.searchParams.get('error')).toBe(ATTACH_TOO_LARGE);
    expect(location.searchParams.get('field')).toBe('documents');
    expect(location.href).not.toContain('ZZ');
    expect(location.href).not.toContain('forged');
    expect(location.href).not.toContain('x.example');
  });

  it('sends the browser nowhere but the page the post was made on', () => {
    const crafted = [
      `/orders/%2F%2Fevil.example`,
      `/orders/@evil.example`,
      `/orders/evil.example%3A443`,
      `/orders/%5C%5Cevil.example`,
      `/orders/x%0D%0ASet-Cookie:%20a=b`,
      `/quoting/quotes/https:%2F%2Fevil.example/convert`,
    ];
    for (const path of crafted) {
      const off = postTooLarge(post(path));
      const on = postTooLarge(post(path, { fromAction: true }));
      expect(off, path).toBeDefined();
      const location = new URL(off?.headers.location ?? '');
      expect(location.origin, path).toBe(ORIGIN);
      expect(location.pathname, path).toBe(path);

      const header = on?.headers['x-action-redirect'] ?? '';
      const landing = new URL(header.replace(/;push$/, ''), `${ORIGIN}/somewhere/else`);
      expect(landing.origin, path).toBe(ORIGIN);
      expect(landing.pathname, path).toBe(path);
      for (const value of [...Object.values(off?.headers ?? {}), header]) {
        expect(value, path).not.toMatch(/[\r\n]/);
      }
    }

    expect(postTooLarge(post('//evil.example/orders/x'))).toBeUndefined();
    expect(postTooLarge(post('/evil.example/orders/x'))).toBeUndefined();
  });
});

describe('the words', () => {
  it('are pinned, and none of them claims a size', () => {
    expect(ATTACH_TOO_LARGE).toBe(
      'That file is over 50 MB, and the limit is 25 MB. Save a smaller copy and attach it again.',
    );
    expect(CREATE_ORDERS_TOO_LARGE).toBe(
      'No order was created. That file is over 50 MB, and the limit is 25 MB. Save a smaller copy, then fill in the boxes again and choose it.',
    );
    expect(RATES_TOO_LARGE).toBe(
      'That file is over 50 MB, which is too large to be a rates file. Load the Rates file, named like Rates_YYQn.csv.',
    );
    expect(
      [ATTACH_TOO_LARGE, CREATE_ORDERS_TOO_LARGE, RATES_TOO_LARGE].map((words) => words.length),
    ).toEqual([89, 135, 111]);
  });

  it('read as the refusals for a file just over its own limit do, with "over 50 MB" for the size', async () => {
    expect(receivedDocumentTooLarge(31 * MB)?.replace('31.0 MB', 'over 50 MB')).toBe(
      ATTACH_TOO_LARGE,
    );
    const rates = await ratesBody(
      new File(['x'.repeat(200 * 1024)], 'wrong.csv'),
      null,
      'wa_dor_rates',
      true,
    );
    expect('refusal' in rates ? rates.refusal.replace('200 KB', 'over 50 MB') : rates).toBe(
      RATES_TOO_LARGE,
    );
    expect(CREATE_ORDERS_TOO_LARGE).toContain(ATTACH_TOO_LARGE.replace(/ Save .*$/, ''));
  });
});

describe('POST_BODY_MAX_BYTES', () => {
  it("is next.config.mjs's two limits, read as Next reads them", () => {
    const nextBytes = createRequire(resolve(__dirname, '..', '..', 'package.json'))(
      'next/dist/compiled/bytes',
    ) as { parse(value: string | number): number | null };
    const limits = [
      nextConfig.experimental?.serverActions?.bodySizeLimit,
      nextConfig.experimental?.middlewareClientMaxBodySize,
    ];
    expect(limits).toHaveLength(2);
    for (const limit of limits) {
      expect(limit).toBeDefined();
      expect(nextBytes.parse(limit ?? 0)).toBe(POST_BODY_MAX_BYTES);
    }
    expect(POST_BODY_MAX_BYTES).toBe(52_428_800);
  });
});
