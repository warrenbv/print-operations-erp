// Tests for the pure rules in docs-freshness. They import the rules from the
// script itself. Commit hashes and dates are fictional.
import { describe, expect, it } from 'vitest';

import { pageStatus, parseLegacyStamp, parseTrailerDirectories } from './docs-freshness.mjs';

describe('parseTrailerDirectories', () => {
  it('reads the written form', () => {
    expect(parseTrailerDirectories('apps/web, modules/quoting')).toEqual([
      'apps/web',
      'modules/quoting',
    ]);
  });

  it('accepts every spelling of the same list', () => {
    // Hand-typed values: doubled commas, tabs, a trailing slash and Windows backslashes.
    const value = ' modules\\orders/ ,,\tapps/api  ,   packages/types ';

    expect(parseTrailerDirectories(value)).toEqual([
      'modules/orders',
      'apps/api',
      'packages/types',
    ]);
  });

  it('reads a single directory, and an absent trailer as nothing', () => {
    expect(parseTrailerDirectories('modules/crm')).toEqual(['modules/crm']);
    expect(parseTrailerDirectories('')).toEqual([]);
    expect(parseTrailerDirectories(undefined)).toEqual([]);
  });
});

describe('parseLegacyStamp', () => {
  it('reads the module form', () => {
    expect(parseLegacyStamp('# crm\n\nVerified against commit 1a2b3c4d on 2026-01-17.\n')).toEqual({
      sha: '1a2b3c4d',
      date: '2026-01-17',
    });
  });

  it('reads the app form', () => {
    // Bold, backticked, with a comma before the date.
    const readme = [
      '# apps/web',
      '',
      '> **Verified against `5e6f7a8b`, 2026-01-21.** Where a sentence here and the code',
      '> disagree, the code is right.',
      '',
    ].join('\n');

    expect(parseLegacyStamp(readme)).toEqual({ sha: '5e6f7a8b', date: '2026-01-21' });
  });

  it('reads the third form, which carries both the word and the backticks', () => {
    // The date falls outside the bold run.
    const readme = '> **Verified against commit `9c0d1e2f`** on 2026-01-18. The verbs, the\n';

    expect(parseLegacyStamp(readme)).toEqual({ sha: '9c0d1e2f', date: '2026-01-18' });
  });

  it('reads a stamp prettier wrapped onto the next line', () => {
    const readme = 'Verified against commit 0abc1234 on\n2026-01-15.\n';

    expect(parseLegacyStamp(readme)).toEqual({ sha: '0abc1234', date: '2026-01-15' });
  });

  it('answers null for a README with no stamp', () => {
    expect(parseLegacyStamp('# db\n\nShared database plumbing.\n')).toBeNull();
    expect(parseLegacyStamp('')).toBeNull();
  });

  it('does not read prose about verification as a stamp', () => {
    expect(
      parseLegacyStamp('Every claim here was verified against the shipped code.\n'),
    ).toBeNull();
  });
});

describe('pageStatus', () => {
  const never = () => {
    throw new Error('ancestry should not have been consulted');
  };

  it('is FRESH when the code commit IS the verifying commit', () => {
    expect(
      pageStatus({ codeSha: 'a'.repeat(40), verifiedSha: 'a'.repeat(40), isAncestor: never }),
    ).toBe('FRESH');
  });

  it('is FRESH when the code commit is an ancestor of the verifying commit', () => {
    // The page was re-read on a later commit that did not touch src.
    expect(pageStatus({ codeSha: 'code', verifiedSha: 'later', isAncestor: () => true })).toBe(
      'FRESH',
    );
  });

  it('is STALE when the code commit is not an ancestor of the verifying commit', () => {
    // Code landed after the last verification: the only status --check fails on.
    expect(pageStatus({ codeSha: 'code', verifiedSha: 'older', isAncestor: () => false })).toBe(
      'STALE',
    );
  });

  it('is NEVER VERIFIED when no trailer and no stamp names the page', () => {
    expect(pageStatus({ codeSha: 'code', verifiedSha: undefined, isAncestor: never })).toBe(
      'NEVER VERIFIED',
    );
    expect(pageStatus({ codeSha: 'code', verifiedSha: null, isAncestor: never })).toBe(
      'NEVER VERIFIED',
    );
  });

  it('is FRESH when nothing has ever been committed under src', () => {
    expect(pageStatus({ codeSha: null, verifiedSha: undefined, isAncestor: never })).toBe('FRESH');
  });
});
