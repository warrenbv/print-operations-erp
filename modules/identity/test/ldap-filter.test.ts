// Tests the filter escaping in modules/identity/src/domain/ldap-filter.ts.
import { describe, expect, it } from 'vitest';

import { escapeLdapFilterValue } from '../src/domain/ldap-filter';

describe('escapeLdapFilterValue', () => {
  it.each([
    ['leaves ordinary usernames unchanged', 'jdoe', 'jdoe'],
    [
      'leaves a UPN unchanged (= is filter structure, not a value char)',
      'jdoe@corp.example',
      'jdoe@corp.example',
    ],
    ['escapes the null byte', 'foo\0bar', 'foo\\00bar'],
    ['escapes the wildcard', 'a*b', 'a\\2ab'],
    ['escapes an opening paren', 'a(b', 'a\\28b'],
    ['escapes a closing paren', 'a)b', 'a\\29b'],
    ['escapes a backslash', 'a\\b', 'a\\5cb'],
    [
      'blocks the classic injection — foo)(objectClass=*',
      'foo)(objectClass=*',
      'foo\\29\\28objectClass=\\2a',
    ],
    ['handles an empty string', '', ''],
  ])('%s', (_label, raw, expected) => {
    expect(escapeLdapFilterValue(raw)).toBe(expected);
  });

  it('does not escape the equals sign — that would break the filter it lives in', () => {
    expect(escapeLdapFilterValue('user=jdoe')).toBe('user=jdoe');
  });
});
