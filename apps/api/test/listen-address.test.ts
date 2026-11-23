// Tests `resolveListenAddress` in apps/api/src/config/listen-address.ts.
import { describe, expect, it } from 'vitest';

import { resolveListenAddress } from '../src/config/listen-address';

describe('resolveListenAddress', () => {
  it('listens on loopback port 3001 when nothing is set', () => {
    expect(resolveListenAddress({})).toEqual({ host: '127.0.0.1', port: 3001 });
  });

  it('treats an empty API_HOST as unset rather than as every interface', () => {
    expect(resolveListenAddress({ API_HOST: '' }).host).toBe('127.0.0.1');
    expect(resolveListenAddress({ API_HOST: '  ' }).host).toBe('127.0.0.1');
  });

  it('listens elsewhere only when API_HOST says so', () => {
    expect(resolveListenAddress({ API_HOST: '0.0.0.0', API_PORT: '4331' })).toEqual({
      host: '0.0.0.0',
      port: 4331,
    });
  });

  it('refuses a port that is not a number', () => {
    expect(() => resolveListenAddress({ API_PORT: 'http://example.test' })).toThrow(/API_PORT/);
    expect(() => resolveListenAddress({ API_PORT: '70000' })).toThrow(/API_PORT/);
  });
});
