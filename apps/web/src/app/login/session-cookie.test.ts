// Tests reading the session cookie out of Set-Cookie and the words for a refused sign-in.
import { describe, expect, it } from 'vitest';

import {
  FAILURE_MESSAGES,
  FALLBACK_MESSAGE,
  readableFailure,
  sessionTokenFrom,
} from './session-cookie';

describe('reading the session out of Set-Cookie', () => {
  it('finds the session cookie and ignores its attributes', () => {
    expect(
      sessionTokenFrom([
        'erp_session=tok7f9; Path=/; Expires=Fri, 21 Aug 2026 08:44:13 GMT; HttpOnly; SameSite=Lax',
      ]),
    ).toBe('tok7f9');
  });

  it('picks the session cookie out of several', () => {
    expect(
      sessionTokenFrom(['other=1; Path=/', 'erp_session=tok7f9; Path=/', 'another=2; Path=/']),
    ).toBe('tok7f9');
  });

  it('does not match a cookie whose name merely contains the session name', () => {
    expect(sessionTokenFrom(['not_erp_session=tok7f9; Path=/'])).toBeUndefined();
    expect(sessionTokenFrom(['erp_session_backup=tok7f9; Path=/'])).toBeUndefined();
  });

  it('treats a cleared cookie as no session', () => {
    expect(sessionTokenFrom(['erp_session=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT'])).toBe(
      undefined,
    );
  });

  it('returns nothing when the API set no cookie at all', () => {
    expect(sessionTokenFrom([])).toBeUndefined();
    expect(sessionTokenFrom(['malformed'])).toBeUndefined();
  });
});

describe('saying why sign-in failed', () => {
  it('writes out the two reasons a client may distinguish', () => {
    expect(readableFailure({ reason: 'invalid-credentials' })).toBe(
      FAILURE_MESSAGES['invalid-credentials'],
    );
    expect(readableFailure({ reason: 'directory-unreachable' })).toBe(
      FAILURE_MESSAGES['directory-unreachable'],
    );
  });

  it('never echoes a reason it does not recognise', () => {
    expect(readableFailure({ reason: 'account-locked' })).toBe(FALLBACK_MESSAGE);
    expect(readableFailure({ reason: 'account-locked' })).not.toContain('account-locked');
  });

  it('survives a body that is not the shape it expects', () => {
    expect(readableFailure(undefined)).toBe(FALLBACK_MESSAGE);
    expect(readableFailure(null)).toBe(FALLBACK_MESSAGE);
    expect(readableFailure('nope')).toBe(FALLBACK_MESSAGE);
    expect(readableFailure({})).toBe(FALLBACK_MESSAGE);
  });

  it('keeps the two messages distinct, because the recoveries differ', () => {
    expect(FAILURE_MESSAGES['invalid-credentials']).not.toBe(
      FAILURE_MESSAGES['directory-unreachable'],
    );
  });
});
