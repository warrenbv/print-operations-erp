// Signs in as one of the demonstration accounts from a role button on the sign-in page.
// It refuses unless demonstration mode is on, and takes the shared password from the configuration the
// launcher sets: apps/web/src/lib/portfolio-demo.ts and scripts/demo-config.mjs.
// The sign-in itself is the ordinary one in apps/web/src/app/login/actions.ts.
'use server';

import { DEMO_ROLES, isPortfolioDemo, portfolioDemoPassword } from '../../lib/portfolio-demo';
import { backWithError } from '../../lib/redirect-error';
import { signInAction } from './actions';

export async function signInDemoAction(formData: FormData): Promise<void> {
  if (!isPortfolioDemo()) backWithError('/login', 'Demo sign-in is not enabled.');
  // The form names a role key, never a username, so only a listed demonstration account can be used.
  const role = DEMO_ROLES.find((candidate) => candidate.key === formData.get('demoRole'));
  if (!role) backWithError('/login', 'Choose one of the demonstration roles.');
  const password = portfolioDemoPassword();
  if (password === undefined)
    backWithError('/login', 'Demo sign-in is not set up. Start the demo with pnpm demo.');
  const credentials = new FormData();
  credentials.set('username', role.username);
  credentials.set('password', password);
  return signInAction(credentials);
}
