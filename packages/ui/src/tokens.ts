// The design tokens and the one style sheet the root layout emits: apps/web/src/app/layout.tsx.
// Colours are CSS variables defined once per palette, so a style built from `COLOR` serves both themes. The sheet also
// holds the rules an inline style cannot express: hover and press, the fold glyphs, narrow screens and print.
export const FONT_FAMILY = 'system-ui, sans-serif';

export type ColorRole =
  | 'page'
  | 'text'
  | 'muted'
  | 'accent'
  | 'danger'
  | 'border'
  | 'warning'
  | 'success'
  | SoftRole
  | FaceRole<'primary'>
  | FaceRole<'danger'>;

type FaceRole<V extends string> = `${V}Face` | `${V}Hover` | `${V}Pressed` | `${V}Text`;

export type SoftRole = 'surface' | 'accentSoft' | 'warningSoft' | 'successSoft' | 'dangerSoft';

export const THEMES = ['system', 'light', 'dark'] as const;
export type Theme = (typeof THEMES)[number];

export const THEME_ATTRIBUTE = 'data-theme';

// Every text role clears WCAG AA on the page and on each soft fill: packages/ui/src/tokens.test.ts.
export const PALETTE: Record<'light' | 'dark', Record<ColorRole, string>> = {
  light: {
    page: '#ffffff',
    text: '#1f2328',

    muted: '#57606a',

    accent: '#0969da',

    danger: '#cf222e',

    border: '#d0d7de',

    warning: '#9a6700',

    success: '#1a7f37',

    surface: '#f6f8fa',
    accentSoft: '#ddf4ff',
    warningSoft: '#fff8c5',
    successSoft: '#dafbe1',
    dangerSoft: '#ffebe9',

    primaryFace: '#0969da',
    primaryHover: '#0860ca',
    primaryPressed: '#0757ba',
    primaryText: '#ffffff',

    dangerFace: '#cf222e',
    dangerHover: '#b91c27',
    dangerPressed: '#a40e26',
    dangerText: '#ffffff',
  },
  dark: {
    page: '#0d1117',
    text: '#e6edf3',
    muted: '#9198a1',
    accent: '#4493f8',
    danger: '#f85149',
    border: '#3d444d',
    warning: '#d29922',
    success: '#3fb950',
    surface: '#161b22',

    accentSoft: '#0b2961',
    warningSoft: '#372a04',
    successSoft: '#0c331a',
    dangerSoft: '#4a1316',

    primaryFace: '#1f6feb',
    primaryHover: '#1a64d6',
    primaryPressed: '#1759c2',
    primaryText: '#ffffff',
    dangerFace: '#da3633',
    dangerHover: '#c62f2c',
    dangerPressed: '#b62324',
    dangerText: '#ffffff',
  },
};

// A designed button face changes on hover and press through these classes, because an inline style cannot.
export const FACE_CLASS = { primary: 'erp-face-primary', danger: 'erp-face-danger' } as const;

function faceStates(variant: keyof typeof FACE_CLASS): string {
  const hover = `var(${cssVariable(`${variant}Hover`)})`;
  const pressed = `var(${cssVariable(`${variant}Pressed`)})`;

  return [
    `.${FACE_CLASS[variant]}:hover { background: ${hover} !important; border-color: ${hover} !important; }`,
    `.${FACE_CLASS[variant]}:active { background: ${pressed} !important; border-color: ${pressed} !important; }`,
  ].join('\n');
}

export const FOLD_CLASS = {
  fold: 'erp-fold',
  bar: 'erp-fold-bar',
  closedGlyph: 'erp-fold-closed',
  openGlyph: 'erp-fold-open',
} as const;

function foldStates(): string {
  const { fold, bar, closedGlyph, openGlyph } = FOLD_CLASS;
  return [
    `.${bar}::-webkit-details-marker { display: none; }`,
    `.${fold}[open] .${closedGlyph} { display: none; }`,
    `.${fold}:not([open]) .${openGlyph} { display: none; }`,
    `.${fold}[open] .${fold}:not([open]) .${closedGlyph} { display: inline; }`,
  ].join('\n');
}

export const RECORD_CLASS = { strip: 'erp-strip', kv: 'erp-kv' } as const;

function recordStates(): string {
  const { strip, kv } = RECORD_CLASS;
  return [
    `.${strip} { grid-auto-flow: column; grid-auto-columns: 1fr; }`,
    `.${kv} { grid-template-columns: 170px 1fr; }`,
    `.${kv} dt { color: ${COLOR.muted}; }`,
    `.${kv} dd { margin: 0; }`,
    `@media (max-width: 720px) { .${strip} { grid-auto-flow: row; grid-auto-columns: auto; } .${kv} { grid-template-columns: 1fr; } }`,
  ].join('\n');
}

// `report` marks a printable page, `hide` the chrome a print drops, and `scroll` a wide table that prints in full.
export const PRINT_CLASS = {
  report: 'erp-print-report',
  hide: 'erp-print-hide',
  scroll: 'erp-print-scroll',
} as const;

function printStates(): string {
  const { report, hide, scroll } = PRINT_CLASS;
  const light = (Object.keys(PALETTE.light) as ColorRole[])
    .map((role) => `${cssVariable(role)}: ${PALETTE.light[role]} !important;`)
    .join(' ');
  return [
    '@media print {',
    `body:has(.${report}) .${hide} { display: none !important; }`,
    `.${report} { max-width: none !important; padding: 0 !important; }`,
    `.${report} .${scroll} { overflow: visible !important; }`,
    `.${report} table { width: 100% !important; }`,
    `.${report} thead { display: table-header-group; }`,
    `.${report} tr { break-inside: avoid; }`,
    `:root:has(.${report}) { color-scheme: light !important; ${light} }`,
    '}',
  ].join('\n');
}

export function cssVariable(role: ColorRole): string {
  return `--erp-${role}`;
}

/** A `var()` reference per colour role, so the theme decides the hex at paint time. Pages style with these, never a hex. */
export const COLOR: Readonly<Record<ColorRole, string>> = Object.fromEntries(
  (Object.keys(PALETTE.light) as ColorRole[]).map((role) => [role, `var(${cssVariable(role)})`]),
) as Record<ColorRole, string>;

export const RADIUS = 6;

export const SPACE = {
  hair: '0.15rem',
  xs: '0.25rem',
  sm: '0.4rem',
  md: '0.5rem',
  lg: '0.75rem',
  xl: '1rem',
  xxl: '1.5rem',
  xxxl: '2rem',
} as const;

export const FONT_SIZE = {
  xs: '0.75rem',
  sm: '0.8rem',
  md: '0.9rem',
  lg: '1.05rem',
  xl: '1.25rem',
} as const;

export const MEASURE = {
  note: 560,
  lede: 640,
} as const;

function declarations(theme: 'light' | 'dark'): string {
  const vars = (Object.keys(PALETTE[theme]) as ColorRole[])
    .map((role) => `${cssVariable(role)}: ${PALETTE[theme][role]};`)
    .join(' ');

  return `color-scheme: ${theme}; ${vars}`;
}

// Follows the system theme unless the page pins one with `data-theme`. The sheet is the text of a style element,
// so it must hold no character React would HTML-escape.
export const THEME_STYLE = [
  `:root { ${declarations('light')} }`,
  `@media (prefers-color-scheme: dark) { :root:not([${THEME_ATTRIBUTE}=light]) { ${declarations('dark')} } }`,
  `:root[${THEME_ATTRIBUTE}=dark] { ${declarations('dark')} }`,
  `body { background: ${COLOR.page}; color: ${COLOR.text}; }`,
  faceStates('primary'),
  faceStates('danger'),
  foldStates(),
  recordStates(),
  printStates(),
].join('\n');
