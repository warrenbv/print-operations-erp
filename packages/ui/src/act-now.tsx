// The Act now panel and its gate list, which open each quote and order page.
// The panel names the one act for this reader, or the desk the record waits on: docs/product/requirements.md (R12).
// A blocked act lists each condition before the click, and the page decides what each says and whether it is clear:
// docs/product/requirements.md (R8). An example: apps/web/src/app/quoting/quotes/[id]/review/act-now-panel.tsx.
import type { ReactNode } from 'react';

import { COLOR, FONT_SIZE, MEASURE, RADIUS, SPACE } from './tokens';

export type ActTone = 'act' | 'waiting' | 'done';

/** One condition on an act. `href` makes its words a link, and `link` adds a separate link after them. */
export interface GateItem {
  readonly text: ReactNode;
  readonly clear: boolean;

  readonly href?: string | undefined;

  readonly link?: { readonly href: string; readonly label: string } | undefined;
}

// Act, waiting and done only. The panel never draws danger.
const TONE: Record<ActTone, { border: string; fill: string }> = {
  act: { border: COLOR.accent, fill: COLOR.accentSoft },
  waiting: { border: COLOR.warning, fill: COLOR.warningSoft },
  done: { border: COLOR.success, fill: COLOR.successSoft },
};

export function ActNow({
  tone,
  title,
  who,
  id,
  label,
  children,
}: {
  tone: ActTone;
  title?: string | undefined;
  who?: ReactNode;
  id?: string | undefined;
  label?: string | undefined;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      aria-label={title ?? label}
      style={{
        border: `1px solid ${TONE[tone].border}`,
        background: TONE[tone].fill,
        borderRadius: RADIUS,
        padding: `${SPACE.xl} 1.25rem`,
        display: 'grid',
        gap: SPACE.lg,
        margin: `${SPACE.xl} 0`,
      }}
    >
      {title !== undefined && (
        <div style={{ display: 'flex', alignItems: 'baseline', gap: SPACE.lg, flexWrap: 'wrap' }}>
          <h2 style={{ fontSize: FONT_SIZE.lg, margin: 0 }}>{title}</h2>
          {who !== undefined && (
            <span style={{ color: COLOR.muted, fontSize: FONT_SIZE.sm }}>{who}</span>
          )}
        </div>
      )}
      {children}
    </section>
  );
}

export function GateList({ gates }: { gates: readonly GateItem[] }) {
  if (gates.length === 0) return null;
  return (
    <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: SPACE.sm }}>
      {gates.map((gate, index) => (
        <li key={String(index)} style={{ display: 'flex', gap: SPACE.md, alignItems: 'baseline' }}>
          <span
            aria-hidden="true"
            style={{
              color: gate.clear ? COLOR.success : COLOR.warning,
              fontWeight: 700,
              width: '1rem',
              flex: 'none',
            }}
          >
            {gate.clear ? '✓' : '○'}
          </span>
          <span style={{ maxWidth: MEASURE.lede }}>
            {gate.href === undefined ? (
              gate.text
            ) : (
              <a href={gate.href} style={{ color: COLOR.accent }}>
                {gate.text}
              </a>
            )}
            {gate.link !== undefined && (
              <>
                {' '}
                <a href={gate.link.href} style={{ color: COLOR.accent }}>
                  {gate.link.label}
                </a>
              </>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function ActRow({ children }: { children: ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: SPACE.lg, flexWrap: 'wrap' }}>
      {children}
    </div>
  );
}

export function ButtonReason({ children }: { children: ReactNode }) {
  return (
    <span style={{ color: COLOR.muted, fontSize: FONT_SIZE.sm, maxWidth: MEASURE.note }}>
      {children}
    </span>
  );
}
