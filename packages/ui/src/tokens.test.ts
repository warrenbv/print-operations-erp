// Tests for the palettes and the style sheet: contrast ratios computed for both themes, every variable defined,
// and the hover, fold, layout and print rules present.
import { describe, expect, it } from 'vitest';

import {
  COLOR,
  type ColorRole,
  FACE_CLASS,
  FOLD_CLASS,
  FONT_SIZE,
  PALETTE,
  PRINT_CLASS,
  RECORD_CLASS,
  SPACE,
  THEME_ATTRIBUTE,
  THEME_STYLE,
  THEMES,
  cssVariable,
} from './tokens';

function channel(eightBit: number): number {
  const s = eightBit / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  const r = channel((n >> 16) & 0xff);
  const g = channel((n >> 8) & 0xff);
  const b = channel(n & 0xff);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const THEME_NAMES = ['light', 'dark'] as const;
const TEXT_ROLES = ['text', 'muted', 'accent', 'danger', 'warning', 'success'] as const;
const FACE_VARIANTS = ['primary', 'danger'] as const;
const SOFT_ROLES = ['surface', 'accentSoft', 'warningSoft', 'successSoft', 'dangerSoft'] as const;

const FILL_TEXT_ROLES = ['text', 'muted', 'accent'] as const;

describe.each(THEME_NAMES)('the %s palette on its own page', (theme) => {
  const palette = PALETTE[theme];

  it.each(TEXT_ROLES)('%s clears WCAG AA for body text', (role) => {
    expect(contrast(palette[role], palette.page)).toBeGreaterThanOrEqual(4.5);
  });

  it('leaves border below the text bar, because it is not text', () => {
    expect(contrast(palette.border, palette.page)).toBeLessThan(3);
  });

  it.each(FACE_VARIANTS)(
    '%s button text clears AA on its face at rest, hovered and pressed',
    (v) => {
      for (const state of ['Face', 'Hover', 'Pressed'] as const) {
        expect(contrast(palette[`${v}Text`], palette[`${v}${state}`])).toBeGreaterThanOrEqual(4.5);
      }
    },
  );

  it.each(FACE_VARIANTS)('%s button face stands out from the page at 3:1', (v) => {
    expect(contrast(palette[`${v}Face`], palette.page)).toBeGreaterThanOrEqual(3);
  });

  it.each(SOFT_ROLES.flatMap((fill) => FILL_TEXT_ROLES.map((role) => [role, fill] as const)))(
    '%s clears WCAG AA on %s',
    (role, fill) => {
      expect(contrast(palette[role], palette[fill])).toBeGreaterThanOrEqual(4.5);
    },
  );

  it('writes every colour as six-digit lower-case hex', () => {
    for (const value of Object.values(palette)) {
      expect(value).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});

describe('the light palette', () => {
  it('shares no colour with the dark palette except white', () => {
    const dark: string[] = Object.values(PALETTE.dark);
    const shared = Object.values(PALETTE.light).filter(
      (value) => value !== '#ffffff' && dark.includes(value),
    );
    expect(shared).toEqual([]);
  });

  it('is actually light, and dark is actually dark', () => {
    expect(luminance(PALETTE.light.page)).toBeGreaterThan(0.9);
    expect(luminance(PALETTE.dark.page)).toBeLessThan(0.02);
  });
});

describe('COLOR, the tokens a style object spreads', () => {
  it('names every role both palettes define, and nothing else', () => {
    expect(Object.keys(COLOR).sort()).toEqual(Object.keys(PALETTE.light).sort());
    expect(Object.keys(PALETTE.dark).sort()).toEqual(Object.keys(PALETTE.light).sort());
  });

  it('is a var() reference per role, so the hex is decided at paint time', () => {
    for (const [role, value] of Object.entries(COLOR) as [ColorRole, string][]) {
      expect(value).toBe(`var(${cssVariable(role)})`);
    }
  });
});

describe('THEME_STYLE, the sheet the layout emits', () => {
  it('defines every variable for both palettes', () => {
    for (const theme of THEME_NAMES) {
      for (const [role, hex] of Object.entries(PALETTE[theme]) as [ColorRole, string][]) {
        expect(THEME_STYLE).toContain(`${cssVariable(role)}: ${hex};`);
      }
    }
  });

  it('follows the OS unless a theme is pinned, and honours a pin either way', () => {
    expect(THEME_STYLE).toContain('@media (prefers-color-scheme: dark)');
    expect(THEME_STYLE).toContain(`:root:not([${THEME_ATTRIBUTE}=light])`);
    expect(THEME_STYLE).toContain(`:root[${THEME_ATTRIBUTE}=dark]`);
  });

  it('carries color-scheme with each palette, so native controls follow the page', () => {
    expect(THEME_STYLE.match(/color-scheme: light;/g)).toHaveLength(1);
    expect(THEME_STYLE.match(/color-scheme: dark;/g)).toHaveLength(2);
  });

  it('paints the page and its text from the variables', () => {
    expect(THEME_STYLE).toContain(`body { background: ${COLOR.page}; color: ${COLOR.text}; }`);
  });

  it('moves each designed face under the pointer and on press, from the variables', () => {
    for (const v of FACE_VARIANTS) {
      const hover = `var(${cssVariable(`${v}Hover`)})`;
      const pressed = `var(${cssVariable(`${v}Pressed`)})`;
      expect(THEME_STYLE).toContain(`.${FACE_CLASS[v]}:hover { background: ${hover} !important;`);
      expect(THEME_STYLE).toContain(
        `.${FACE_CLASS[v]}:active { background: ${pressed} !important;`,
      );
    }

    expect(THEME_STYLE.match(/:hover/g)).toHaveLength(FACE_VARIANTS.length);
    expect(THEME_STYLE.match(/:active/g)).toHaveLength(FACE_VARIANTS.length);
  });

  it('hides the fold marker and shows the glyph that matches [open]', () => {
    const { fold, bar, closedGlyph, openGlyph } = FOLD_CLASS;
    expect(THEME_STYLE).toContain(`.${bar}::-webkit-details-marker { display: none; }`);
    expect(THEME_STYLE).toContain(`.${fold}[open] .${closedGlyph} { display: none; }`);
    expect(THEME_STYLE).toContain(`.${fold}:not([open]) .${openGlyph} { display: none; }`);

    expect(THEME_STYLE).toContain(
      `.${fold}[open] .${fold}:not([open]) .${closedGlyph} { display: inline; }`,
    );
  });

  it('lays the record parts out across, and down under 720px', () => {
    const { strip, kv } = RECORD_CLASS;
    expect(THEME_STYLE).toContain(`.${strip} { grid-auto-flow: column; grid-auto-columns: 1fr; }`);
    expect(THEME_STYLE).toContain(`.${kv} { grid-template-columns: 170px 1fr; }`);
    expect(THEME_STYLE).toContain(`.${kv} dt { color: ${COLOR.muted}; }`);
    expect(THEME_STYLE).toContain(
      `@media (max-width: 720px) { .${strip} { grid-auto-flow: row; grid-auto-columns: auto; } .${kv} { grid-template-columns: 1fr; } }`,
    );
  });

  it('prints a report page without its controls, at full width, in the light palette', () => {
    const { report, hide, scroll } = PRINT_CLASS;
    const block = THEME_STYLE.slice(THEME_STYLE.indexOf('@media print {'));
    expect(THEME_STYLE.match(/@media print \{/g)).toHaveLength(1);

    expect(block).toContain(`body:has(.${report}) .${hide} { display: none !important; }`);
    expect(block).toContain(`.${report} { max-width: none !important; padding: 0 !important; }`);
    expect(block).toContain(`.${report} .${scroll} { overflow: visible !important; }`);
    expect(block).toContain(`.${report} table { width: 100% !important; }`);
    expect(block).toContain(`.${report} thead { display: table-header-group; }`);
    expect(block).toContain(`.${report} tr { break-inside: avoid; }`);

    expect(block).toContain(`:root:has(.${report}) { color-scheme: light !important;`);
    for (const [role, hex] of Object.entries(PALETTE.light) as [ColorRole, string][]) {
      expect(block).toContain(`${cssVariable(role)}: ${hex} !important;`);
    }

    expect(block.trimEnd().endsWith('}\n}')).toBe(true);
  });

  it('contains nothing React would HTML-escape', () => {
    expect(THEME_STYLE).not.toMatch(/["'<>&]/);
  });
});

describe('the theme names', () => {
  it('offers system, light and dark, with system first as the default', () => {
    expect(THEMES).toEqual(['system', 'light', 'dark']);
  });

  it('pins the attribute to the spelling the root layout writes on <html>', () => {
    expect(THEME_ATTRIBUTE).toBe('data-theme');
  });

  it('names a palette for each theme that is not system', () => {
    for (const theme of THEMES) {
      if (theme === 'system') continue;
      expect(PALETTE).toHaveProperty(theme);
    }
  });
});

describe('the scales', () => {
  it('lists spacing smallest to largest', () => {
    const rems = Object.values(SPACE).map((v) => Number.parseFloat(v));
    expect(rems).toEqual([...rems].sort((a, b) => a - b));
  });

  it('lists font sizes smallest to largest', () => {
    const rems = Object.values(FONT_SIZE).map((v) => Number.parseFloat(v));
    expect(rems).toEqual([...rems].sort((a, b) => a - b));
  });

  it('keeps every scale value in rem, so nothing is pinned to pixels', () => {
    for (const value of [...Object.values(SPACE), ...Object.values(FONT_SIZE)]) {
      expect(value).toMatch(/^\d*\.?\d+rem$/);
    }
  });
});
