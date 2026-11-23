// Message banners. Each renders nothing when it has nothing to say, so a page can pass an optional message straight in.
// Errors and dangers carry role alert and are announced. Warnings and information are read in place.
import type { ReactNode } from 'react';

import { COLOR, RADIUS, SPACE } from './tokens';

const BANNER_PADDING = '0.6rem 0.9rem';

function bannerStyle(color: string) {
  return {
    border: `1px solid ${color}`,
    borderRadius: RADIUS,
    padding: BANNER_PADDING,
    margin: `${SPACE.xl} 0`,
  } as const;
}

export function ErrorBanner({ message }: { message: string | undefined }) {
  if (message === undefined || message === '') return null;
  return (
    <p role="alert" style={{ ...bannerStyle(COLOR.danger), color: COLOR.danger }}>
      {message}
    </p>
  );
}

/** True for what React draws as nothing. A zero is a real message and still renders. */
export function rendersNothing(children: ReactNode): boolean {
  return (
    children === undefined || children === null || typeof children === 'boolean' || children === ''
  );
}

export function InfoBanner({ children }: { children: ReactNode }) {
  if (rendersNothing(children)) return null;
  return <p style={bannerStyle(COLOR.accent)}>{children}</p>;
}

export function WarnBanner({ children }: { children: ReactNode }) {
  if (rendersNothing(children)) return null;
  return <p style={{ ...bannerStyle(COLOR.warning), color: COLOR.warning }}>{children}</p>;
}

export function DangerBanner({ children }: { children: ReactNode }) {
  if (rendersNothing(children)) return null;
  return (
    <p role="alert" style={{ ...bannerStyle(COLOR.danger), color: COLOR.danger }}>
      {children}
    </p>
  );
}
