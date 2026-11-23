// Tests the theme cookie parsing, the page attribute and the picker labels.
import { THEMES } from '@erp/ui';
import { describe, expect, it } from 'vitest';

import { THEME_COOKIE, THEME_LABEL, isTheme, parseTheme, themeAttribute } from './theme';

describe('parseTheme', () => {
  it.each(THEMES)('accepts %s', (theme) => {
    expect(parseTheme(theme)).toBe(theme);
  });

  it('reads no cookie as system', () => {
    expect(parseTheme(undefined)).toBe('system');
  });

  it.each(['', 'DARK', 'darkish', 'auto', '1', ' dark'])('reads %j as system', (junk) => {
    expect(parseTheme(junk)).toBe('system');
  });
});

describe('isTheme', () => {
  it('refuses a non-string that happens to stringify to a theme', () => {
    expect(isTheme({ toString: () => 'dark' })).toBe(false);
    expect(isTheme(null)).toBe(false);
  });
});

describe('themeAttribute', () => {
  it('omits the attribute for system, so the media query decides', () => {
    expect(themeAttribute('system')).toBeUndefined();
  });

  it('stamps the pinned theme', () => {
    expect(themeAttribute('light')).toBe('light');
    expect(themeAttribute('dark')).toBe('dark');
  });
});

describe('the picker', () => {
  it('has a label for every theme', () => {
    expect(Object.keys(THEME_LABEL).sort()).toEqual([...THEMES].sort());
  });

  it('uses a cookie name in the app prefix, beside the session cookie', () => {
    expect(THEME_COOKIE).toMatch(/^erp_/);
  });
});
