// The sign-in page. In demonstration mode it shows one button per demonstration role and no username
// and password form. Otherwise it shows only the form. A signed-in visitor goes straight to Your work.
import { redirect } from 'next/navigation';

import { Button, ErrorBanner, Field, FieldLabel, Input, PageLede, PageShell, SPACE } from '@erp/ui';

import { loadMe } from '../../lib/load-me';
import { isPortfolioDemo } from '../../lib/portfolio-demo';
import { signInAction } from './actions';
import { DemoRoleChoices } from './demo-role-choices';

export const metadata = { title: 'Sign in' };

interface PageProps {
  searchParams: Promise<{ error?: string }>;
}

export default async function LoginPage({ searchParams }: PageProps) {
  const { error } = await searchParams;
  const demo = isPortfolioDemo();

  if (await signedIn()) {
    redirect('/');
  }

  return (
    <PageShell>
      <h1>{demo ? 'Explore Print Operations ERP' : 'Sign in'}</h1>

      <PageLede>
        {demo
          ? 'Choose a fictional role to explore a customer request from quote to order. Each role keeps its own responsibilities and permissions.'
          : 'Sign in with your network username and password.'}
      </PageLede>

      <ErrorBanner message={error} />

      {demo && <DemoRoleChoices />}
      {demo && (
        <p>
          <a href="/demo">Read the short demo guide</a>
        </p>
      )}
      {!demo && (
        <form action={signInAction} style={{ display: 'grid', gap: SPACE.lg, maxWidth: 320 }}>
          <Field>
            <FieldLabel>Username</FieldLabel>

            <Input type="text" name="username" required autoComplete="username" autoFocus />
          </Field>

          <Field>
            <FieldLabel>Password</FieldLabel>
            <Input type="password" name="password" required autoComplete="current-password" />
          </Field>

          <div>
            <Button variant="primary">Sign in</Button>
          </div>
        </form>
      )}
    </PageShell>
  );
}

// On this page an unanswered session read throws instead of redirecting (apps/web/src/lib/api-outage.ts).
// Treating that as signed out keeps the page up, and the top bar says sign-in is unavailable.
async function signedIn(): Promise<boolean> {
  try {
    return (await loadMe()) !== null;
  } catch {
    return false;
  }
}
