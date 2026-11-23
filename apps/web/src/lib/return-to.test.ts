// Tests that only the listed return paths are honoured.
import { describe, expect, it } from 'vitest';

import { RETURN_TARGETS, resolveReturnTo } from './return-to';

describe('resolveReturnTo', () => {
  it('resolves the paths on the list', () => {
    for (const target of RETURN_TARGETS) {
      expect(resolveReturnTo(target)).toBe(target);
    }
  });

  it('answers undefined for a path that is not on the list', () => {
    expect(resolveReturnTo('/admin/users')).toBeUndefined();
    expect(resolveReturnTo('/')).toBeUndefined();
  });

  it('answers undefined for anything off this site', () => {
    expect(resolveReturnTo('https://elsewhere.example/pay')).toBeUndefined();

    expect(resolveReturnTo('//elsewhere.example/pay')).toBeUndefined();
    expect(resolveReturnTo('/\\elsewhere.example/pay')).toBeUndefined();
  });

  it('answers undefined when there is no marker at all', () => {
    expect(resolveReturnTo(undefined)).toBeUndefined();
    expect(resolveReturnTo('')).toBeUndefined();
  });

  it('keeps the bare path and drops a query or fragment the caller appended', () => {
    expect(resolveReturnTo('/quoting/quotes/new?q=acme')).toBe('/quoting/quotes/new');
    expect(resolveReturnTo('/quoting/quotes/new#lines')).toBe('/quoting/quotes/new');
  });

  it('does not resolve a path that merely starts with a target', () => {
    expect(resolveReturnTo('/quoting/quotes/newer')).toBeUndefined();
  });
});
