// The colour theme choice, kept in a cookie so the server renders the chosen theme: apps/web/src/app/layout.tsx.
// The themes are defined in packages/ui/src/tokens.ts.
import { type Theme, THEMES } from '@erp/ui';

export const THEME_COOKIE = 'erp_theme';

export const THEME_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

export function isTheme(value: unknown): value is Theme {
  return typeof value === 'string' && (THEMES as readonly string[]).includes(value);
}

export function parseTheme(value: string | undefined): Theme {
  return isTheme(value) ? value : 'system';
}

export function themeAttribute(theme: Theme): 'light' | 'dark' | undefined {
  return theme === 'system' ? undefined : theme;
}

export const THEME_LABEL: Record<Theme, string> = {
  system: 'System',
  light: 'Light',
  dark: 'Dark',
};
