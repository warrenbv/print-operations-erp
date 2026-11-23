// The demonstration sign-in: the switch that turns it on and the accounts the sign-in page offers.
// The launcher sets `PORTFOLIO_DEMO` and `PORTFOLIO_DEMO_PASSWORD` in the web process's environment: scripts/demo-config.mjs.
// This file holds no password. The sign-in action is apps/web/src/app/login/demo-actions.ts.
// One sign-in choice per entry. Each username must be one of the local accounts the launcher creates,
// `demoAccounts` in scripts/demo-config.mjs.
export const DEMO_ROLES = [
  {
    key: 'sales',
    username: 'dev-sales',
    label: 'Sales',
    task: 'Create a quote and turn an accepted quote into an order.',
  },
  {
    key: 'production',
    username: 'dev-production-manager',
    label: 'Production Manager',
    task: 'Supply lead time and confirm the order.',
  },
  {
    key: 'billing',
    username: 'dev-billing',
    label: 'Billing Manager',
    task: 'Approve hand-set prices and credit-hold exceptions, and keep pricing and tax rates current.',
  },
  {
    key: 'admin',
    username: 'dev-admin',
    label: 'Administrator',
    task: 'Grant roles to the people on the team, and release a quote priced below the floor.',
  },
] as const;

export function portfolioDemoPassword(): string | undefined {
  const password = process.env.PORTFOLIO_DEMO_PASSWORD;
  return password === undefined || password === '' ? undefined : password;
}

/**
 * True only when the flag is set and the API is plain HTTP on this machine, so the flag alone never turns
 * demo sign-in on against an API elsewhere. Any malformed API address answers false.
 */
export function isPortfolioDemo(): boolean {
  if (process.env.PORTFOLIO_DEMO !== 'true') return false;
  try {
    const api = new URL(process.env.API_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? '');
    return api.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(api.hostname);
  } catch {
    return false;
  }
}
