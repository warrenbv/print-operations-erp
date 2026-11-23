// Tests username normalisation and the break-glass name match in modules/identity/src/domain/username.ts.
import { describe, expect, it } from 'vitest';

import { isBreakGlassUsername, normalizeUsername } from '../src/domain/username';

describe('normalizeUsername', () => {
  it.each([
    ['trims whitespace', '  jdoe ', 'jdoe'],
    ['lowercases', 'JDoe', 'jdoe'],
    ['handles a UPN form', ' JDoe@Corp.Example ', 'jdoe@corp.example'],
    ['leaves a normalized name unchanged', 'jdoe', 'jdoe'],
  ])('%s', (_label, raw, expected) => {
    expect(normalizeUsername(raw)).toBe(expected);
  });
});

describe('isBreakGlassUsername', () => {
  it('matches the reserved username case- and whitespace-insensitively', () => {
    expect(isBreakGlassUsername(' Break-Glass ', 'break-glass')).toBe(true);
  });

  it('does not match ordinary usernames', () => {
    expect(isBreakGlassUsername('jdoe', 'break-glass')).toBe(false);
  });

  it('does not match a prefix or suffix of the reserved name', () => {
    expect(isBreakGlassUsername('break-glass2', 'break-glass')).toBe(false);
    expect(isBreakGlassUsername('a-break-glass', 'break-glass')).toBe(false);
  });
});
