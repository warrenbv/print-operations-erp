// The root layout: the top bar, the theme and, in demonstration mode, the demo banner around every page.
// It reads the session once per request and draws the navigation for the signed-in roles: apps/web/src/app/nav/top-bar.tsx.
// Page titles are templated here and checked by apps/web/src/app/every-page-has-a-title.test.ts.
import { COLOR, FONT_FAMILY, PRINT_CLASS, SPACE, THEME_STYLE } from '@erp/ui';
import { cookies, headers } from 'next/headers';
import type { ReactNode } from 'react';

import { loadMailRedirect } from '../lib/load-mail-mode';
import { loadSessionOutcome } from '../lib/load-me';
import { isPortfolioDemo } from '../lib/portfolio-demo';
import { THEME_COOKIE, parseTheme, themeAttribute } from '../lib/theme';
import { APP_NAME, TITLE_TEMPLATE } from '../lib/titles';
import { loadNavCounts } from '../lib/work/load-counts';
import { activeGroupId } from './nav/nav-map';
import { TopBar } from './nav/top-bar';

export const metadata = {
  title: { template: TITLE_TEMPLATE, default: APP_NAME },
  description: 'A portfolio demonstration of connected print operations, from quote to order.',
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const demo = isPortfolioDemo();
  const pathname = (await headers()).get('x-pathname') ?? '/';
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  const outcome = await loadSessionOutcome();

  const mailRedirect = outcome.kind === 'signed-in' ? await loadMailRedirect() : null;

  const counts =
    outcome.kind === 'signed-in' ? await loadNavCounts(outcome.me, activeGroupId(pathname)) : {};

  return (
    <html lang="en" data-theme={themeAttribute(theme)}>
      <head>
        <style>{THEME_STYLE}</style>
      </head>
      <body style={{ margin: 0 }}>
        <TopBar
          me={outcome.kind === 'signed-in' ? outcome.me : null}
          pathname={pathname}
          theme={theme}
          apiReachable={outcome.kind === 'signed-in' || outcome.kind === 'signed-out'}
          mailRedirect={mailRedirect}
          counts={counts}
          demo={demo}
        />
        {demo && (
          <aside
            aria-label="Portfolio demo"
            className={PRINT_CLASS.hide}
            style={{
              padding: `${SPACE.md} ${SPACE.xxxl}`,
              borderBottom: `1px solid ${COLOR.border}`,
              background: COLOR.accentSoft,
              color: COLOR.text,
              fontFamily: FONT_FAMILY,
              fontSize: '0.9rem',
              lineHeight: 1.5,
            }}
          >
            <strong>Portfolio demo</strong> · Fictional data · Changes reset on restart ·{' '}
            <a href="/demo">Demo guide</a>
          </aside>
        )}
        {children}
      </body>
    </html>
  );
}
