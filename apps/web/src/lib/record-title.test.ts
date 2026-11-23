// Tests record tab titles for found, missing and unread records, and the order's queue name.
import { randomUUID } from 'node:crypto';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SessionOutcome } from './load-me';

const session = vi.hoisted(() => ({ outcome: { kind: 'signed-out' } as SessionOutcome }));
const api = vi.hoisted(() => ({
  fetch: vi.fn<(path: string) => Promise<Response>>(),
}));

vi.mock('./load-me', () => ({
  loadSessionOutcome: () => Promise.resolve(session.outcome),
}));
vi.mock('./api-fetch', () => ({ apiFetch: (path: string) => api.fetch(path) }));

const { queueName, recordTitle } = await import('./record-title');

const schema = {
  parse(input: unknown): { number: string } {
    const { number } = input as { number?: unknown };
    if (typeof number !== 'string') throw new Error('bad body');
    return { number };
  },
};

const ID = randomUUID();
const PATH = `/quoting/quotes/${ID}`;

function title(): Promise<string> {
  return recordTitle(PATH, schema, (thing) => `Thing ${thing.number}`, 'Thing');
}

const SIGNED_IN = {
  kind: 'signed-in',
  me: { id: 'u', username: 'u', displayName: 'U', roles: [] },
} as unknown as SessionOutcome;

describe('recordTitle', () => {
  beforeEach(() => {
    session.outcome = SIGNED_IN;
    api.fetch.mockReset();
  });

  it('names the record from the page path when the read answers', async () => {
    api.fetch.mockResolvedValue(Response.json({ number: 'T-7' }));
    await expect(title()).resolves.toBe('Thing T-7');
    expect(api.fetch).toHaveBeenCalledWith(PATH);
  });

  it('falls back without reading the record for a signed-out reader', async () => {
    session.outcome = { kind: 'signed-out' };
    await expect(title()).resolves.toBe('Thing');
    expect(api.fetch).not.toHaveBeenCalled();
  });

  it('names a 404 as the not-found page does, so the tab matches the boundary', async () => {
    api.fetch.mockResolvedValue(new Response(null, { status: 404 }));
    await expect(title()).resolves.toBe('Not found');
  });

  it('names a 404 as the page asks when the page shows its own refusal', async () => {
    api.fetch.mockResolvedValue(new Response(null, { status: 404 }));
    await expect(
      recordTitle(PATH, schema, (thing) => thing.number, 'Thing', { whenMissing: 'Things' }),
    ).resolves.toBe('Things');
  });

  it.each([401, 403, 500, 503])('falls back on a %i', async (status) => {
    api.fetch.mockResolvedValue(new Response(null, { status }));
    await expect(title()).resolves.toBe('Thing');
  });

  it('falls back on a body the schema refuses', async () => {
    api.fetch.mockResolvedValue(Response.json({ other: 1 }));
    await expect(title()).resolves.toBe('Thing');
  });

  it('falls back when the API does not answer', async () => {
    api.fetch.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(title()).resolves.toBe('Thing');
  });
});

describe('queueName', () => {
  it('is the bare job number once the order is confirmed', () => {
    expect(queueName({ id: ID, jobNumber: 'DPW-00244' }, 'Q-00066')).toBe('DPW-00244');
  });

  it('names the quote before confirmation', () => {
    expect(queueName({ id: ID }, 'Q-00066 v2')).toBe('Order from Q-00066 v2');
  });

  it('falls back to the id tail when the quote was not found', () => {
    expect(queueName({ id: ID }, null)).toMatch(/^Order \S+$/);
  });
});
