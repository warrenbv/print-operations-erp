// Tests the banner redirect URLs and their encoding.
import { describe, expect, it } from 'vitest';

import { errorUrl, noticeUrl } from './redirect-error';

describe('errorUrl on the pages that bounce a refusal', () => {
  const message = 'Approval failed';
  const encoded = 'Approval%20failed';

  it('builds a fixed-path bounce', () => {
    expect(errorUrl('/approvals', message)).toBe(`/approvals?error=${encoded}`);
    expect(errorUrl('/production/lead-times', message)).toBe(
      `/production/lead-times?error=${encoded}`,
    );
    expect(errorUrl('/quoting/grades', message)).toBe(`/quoting/grades?error=${encoded}`);
    expect(errorUrl('/quoting/tiers', message)).toBe(`/quoting/tiers?error=${encoded}`);
  });

  it('builds a bounce that carries an id, with the id already encoded by the caller', () => {
    const id = 'a1b2';
    expect(errorUrl(`/orders/${encodeURIComponent(id)}`, message)).toBe(
      `/orders/a1b2?error=${encoded}`,
    );
    expect(errorUrl(`/quoting/quotes/${encodeURIComponent(id)}`, message)).toBe(
      `/quoting/quotes/a1b2?error=${encoded}`,
    );
    expect(errorUrl(`/quoting/quotes/${encodeURIComponent(id)}/convert`, message)).toBe(
      `/quoting/quotes/a1b2/convert?error=${encoded}`,
    );
  });

  it('builds the new-quote bounce, which keeps the customer search', () => {
    expect(errorUrl('/quoting/quotes/new', message, { q: 'Example Customer & Sons' })).toBe(
      `/quoting/quotes/new?error=${encoded}&q=Example%20Customer%20%26%20Sons`,
    );
  });
});

describe('errorUrl', () => {
  it('encodes what a banner message actually contains', () => {
    expect(errorUrl('/p', 'freight margin must be under 100% — you entered 340%.')).toBe(
      '/p?error=freight%20margin%20must%20be%20under%20100%25%20%E2%80%94%20you%20entered%20340%25.',
    );
    expect(errorUrl('/p', '"AB-1" does not match')).toBe(
      '/p?error=%22AB-1%22%20does%20not%20match',
    );
  });

  it('omits the tail entirely when there is no extra query', () => {
    expect(errorUrl('/p', 'x')).toBe('/p?error=x');
  });

  it('appends extra query after the error, in the order given', () => {
    expect(errorUrl('/p', 'x', { a: '1', b: '2' })).toBe('/p?error=x&a=1&b=2');
  });

  it('encodes an extra value rather than trusting it', () => {
    expect(errorUrl('/p', 'x', { q: 'a b&c=d' })).toBe('/p?error=x&q=a%20b%26c%3Dd');
  });
});

describe('noticeUrl', () => {
  it('uses the other channel', () => {
    expect(noticeUrl('/quoting/tiers', 'Tier 2 saved')).toBe(
      '/quoting/tiers?notice=Tier%202%20saved',
    );
  });
});
