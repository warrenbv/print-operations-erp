// The top bar: the groups, the current group's pages with their queue counts, the signed-in name,
// sign-out and the theme picker. Every link is a plain anchor, so each navigation is a full page load
// and the server draws the bar for the new path: docs/decisions/004-server-first-web-ui.md.
// In demonstration mode sign-out reads Switch demo role, because it returns to the role buttons.
import type { MailRedirectView, SessionUser } from '@erp/types';
import {
  Button,
  COLOR,
  CountBadge,
  FONT_FAMILY,
  FONT_SIZE,
  PRINT_CLASS,
  SPACE,
  THEMES,
  type Theme,
} from '@erp/ui';

import { THEME_LABEL } from '../../lib/theme';
import { APP_NAME } from '../../lib/titles';
import { setThemeAction, signOutAction } from './actions';
import { MailModeNotice } from './mail-mode-notice';
import { activeGroupId, isCurrentItem, itemCount, visibleGroups, type NavCounts } from './nav-map';

export function TopBar({
  me,
  pathname,
  theme,
  apiReachable = true,
  mailRedirect = null,
  counts = {},
  demo = false,
}: {
  me: SessionUser | null;
  pathname: string;
  theme: Theme;
  apiReachable?: boolean;

  mailRedirect?: MailRedirectView | null;

  counts?: NavCounts;
  demo?: boolean;
}) {
  return (
    <header className={PRINT_CLASS.hide} style={barStyle}>
      <div style={rowStyle}>
        <a href="/" style={brandStyle}>
          {APP_NAME}
        </a>
        {me === null ? (
          <SignedOut apiReachable={apiReachable} />
        ) : (
          <SignedIn me={me} pathname={pathname} />
        )}

        <div style={personalStyle}>
          {me !== null && <Identity me={me} demo={demo} />}
          <ThemePicker theme={theme} />
        </div>
      </div>

      {me !== null && <SecondRow me={me} pathname={pathname} counts={counts} />}
      {me !== null && <MailModeNotice redirect={mailRedirect} />}
    </header>
  );
}

function SignedOut({ apiReachable }: { apiReachable: boolean }) {
  return (
    <nav aria-label="Primary" style={navStyle}>
      {apiReachable ? (
        <a href="/login" style={linkStyle}>
          Sign in
        </a>
      ) : (
        <span style={{ color: COLOR.warning, fontSize: FONT_SIZE.md }}>
          Cannot reach the API — sign-in is unavailable.
        </span>
      )}
    </nav>
  );
}

function SignedIn({ me, pathname }: { me: SessionUser; pathname: string }) {
  const groups = visibleGroups(me.roles);
  const active = activeGroupId(pathname);

  return (
    <nav aria-label="Primary" style={navStyle}>
      {groups.map((group) => {
        const isActive = group.id === active;
        const first = group.items[0];
        if (first === undefined) return null;
        return (
          <a
            key={group.id}
            href={first.href}
            aria-current={isActive ? 'true' : undefined}
            style={isActive ? { ...linkStyle, ...activeLinkStyle } : linkStyle}
          >
            {group.label}
          </a>
        );
      })}
    </nav>
  );
}

function Identity({ me, demo }: { me: SessionUser; demo: boolean }) {
  return (
    <>
      <span style={identityNameStyle} title={me.username}>
        {me.displayName}
      </span>

      <form action={signOutAction}>
        <Button style={smallButtonStyle}>{demo ? 'Switch demo role' : 'Sign out'}</Button>
      </form>
    </>
  );
}

function ThemePicker({ theme }: { theme: Theme }) {
  return (
    <form action={setThemeAction} aria-label="Theme" style={pickerStyle}>
      <span style={pickerLabelStyle}>Theme</span>
      {THEMES.map((option) => {
        const current = option === theme;
        return (
          <Button
            key={option}
            name="theme"
            value={option}
            ariaPressed={current}
            style={current ? { ...smallButtonStyle, ...pressedStyle } : smallButtonStyle}
          >
            {THEME_LABEL[option]}
          </Button>
        );
      })}
    </form>
  );
}

function SecondRow({
  me,
  pathname,
  counts,
}: {
  me: SessionUser;
  pathname: string;
  counts: NavCounts;
}) {
  const active = activeGroupId(pathname);
  const group = visibleGroups(me.roles).find((g) => g.id === active);
  if (group === undefined || group.items.length < 2) return null;

  return (
    <nav aria-label={group.label} style={secondRowStyle}>
      {group.items.map((item) => {
        const current = isCurrentItem(pathname, item.href);
        const count = itemCount(item, counts);
        return (
          <a
            key={item.href}
            href={item.href}
            aria-current={current ? 'page' : undefined}
            style={current ? { ...subLinkStyle, ...activeLinkStyle } : subLinkStyle}
          >
            {item.label}

            {count > 0 ? ' ' : null}
            <CountBadge count={count} />
          </a>
        );
      })}
    </nav>
  );
}

const barStyle = {
  fontFamily: FONT_FAMILY,
  borderBottom: `1px solid ${COLOR.border}`,
} as const;

const rowStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: SPACE.xl,
  padding: `${SPACE.lg} ${SPACE.xxxl}`,
  flexWrap: 'wrap',
} as const;

const secondRowStyle = {
  display: 'flex',
  gap: SPACE.xl,
  padding: `${SPACE.md} ${SPACE.xxxl}`,
  borderTop: `1px solid ${COLOR.border}`,
  flexWrap: 'wrap',
} as const;

const brandStyle = {
  color: 'inherit',
  textDecoration: 'none',
  fontWeight: 700,
} as const;

const navStyle = { display: 'flex', gap: SPACE.xl, flexWrap: 'wrap' } as const;

const linkStyle = { color: COLOR.accent, textDecoration: 'none' } as const;

const subLinkStyle = {
  color: COLOR.accent,
  textDecoration: 'none',
  fontSize: FONT_SIZE.md,
} as const;

const activeLinkStyle = {
  color: 'inherit',
  fontWeight: 600,
  textDecoration: 'underline',
} as const;

const personalStyle = {
  marginLeft: 'auto',
  display: 'flex',
  alignItems: 'center',
  gap: SPACE.lg,
  flexWrap: 'wrap',
} as const;

const identityNameStyle = {
  color: COLOR.muted,
  fontSize: FONT_SIZE.sm,
  whiteSpace: 'nowrap',
} as const;

const smallButtonStyle = {
  fontFamily: 'inherit',
  fontSize: FONT_SIZE.sm,
  padding: `${SPACE.xs} ${SPACE.md}`,
} as const;

const pickerStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: SPACE.xs,
  margin: 0,
} as const;

const pickerLabelStyle = {
  color: COLOR.muted,
  fontSize: FONT_SIZE.sm,
  marginRight: SPACE.xs,
} as const;

const pressedStyle = {
  fontWeight: 600,
  textDecoration: 'underline',
} as const;
