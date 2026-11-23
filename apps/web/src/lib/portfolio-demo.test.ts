// Tests the demonstration switch, the offered accounts, and that the password comes only from the environment.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEMO_ROLES, isPortfolioDemo, portfolioDemoPassword } from './portfolio-demo';

afterEach(() => vi.unstubAllEnvs());

describe('portfolio role entry', () => {
  it('is disabled without the explicit demo flag', () => {
    vi.stubEnv('PORTFOLIO_DEMO', '');
    vi.stubEnv('API_INTERNAL_URL', 'http://127.0.0.1:4331');
    expect(isPortfolioDemo()).toBe(false);
  });

  it('refuses a non-local API even when the flag is set', () => {
    vi.stubEnv('PORTFOLIO_DEMO', 'true');
    vi.stubEnv('API_INTERNAL_URL', 'https://service.example.test');
    expect(isPortfolioDemo()).toBe(false);
  });

  it('allows the isolated loopback demo and only named fictional users', () => {
    vi.stubEnv('PORTFOLIO_DEMO', 'true');
    vi.stubEnv('API_INTERNAL_URL', 'http://127.0.0.1:4331');
    expect(isPortfolioDemo()).toBe(true);
    expect(DEMO_ROLES.map((role) => role.username)).toEqual([
      'dev-sales',
      'dev-production-manager',
      'dev-billing',
      'dev-admin',
    ]);
  });

  it('gives every role a distinct key, label and account', () => {
    for (const field of ['key', 'label', 'username'] as const) {
      expect(new Set(DEMO_ROLES.map((role) => role[field])).size).toBe(DEMO_ROLES.length);
    }
  });

  it('takes the demo password from the environment and has none of its own', () => {
    vi.stubEnv('PORTFOLIO_DEMO_PASSWORD', '');
    expect(portfolioDemoPassword()).toBeUndefined();
    vi.stubEnv('PORTFOLIO_DEMO_PASSWORD', 'example-password');
    expect(portfolioDemoPassword()).toBe('example-password');
  });
});
