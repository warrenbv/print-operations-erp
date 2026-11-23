// The page frame and block components: the centred page, sections, boxes, lists, the empty state and the status chip.
import type { CSSProperties, ReactNode } from 'react';

import { SectionNote } from './helptext';
import { COLOR, FONT_FAMILY, FONT_SIZE, PRINT_CLASS, RADIUS, SPACE } from './tokens';

const FRAME_WIDTH = 1100;

/** The centred page frame. `printable` marks a report page for the print rules in `THEME_STYLE`. */
export function PageShell({
  children,
  printable = false,
}: {
  children: ReactNode;
  printable?: boolean;
}) {
  return (
    <main
      className={printable ? PRINT_CLASS.report : undefined}
      style={{
        fontFamily: FONT_FAMILY,
        padding: SPACE.xxxl,
        maxWidth: FRAME_WIDTH,
        margin: '0 auto',
      }}
    >
      {children}
    </main>
  );
}

export function TableScroll({ children }: { children: ReactNode }) {
  return (
    <div className={PRINT_CLASS.scroll} style={{ overflowX: 'auto' }}>
      {children}
    </div>
  );
}

export function Section({
  title,
  note,
  id,
  children,
}: {
  title: ReactNode;
  note?: ReactNode;

  id?: string;
  children: ReactNode;
}) {
  return (
    <section id={id} style={{ marginTop: SPACE.xxl }}>
      <h2 style={{ fontSize: FONT_SIZE.lg, marginBottom: SPACE.md }}>{title}</h2>
      <SectionNote>{note}</SectionNote>
      {children}
    </section>
  );
}

export function Box({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div
      style={{
        border: `1px solid ${COLOR.border}`,
        borderRadius: RADIUS,
        padding: '0.75rem 1rem',
        display: 'grid',
        gap: SPACE.md,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export function ResetList({ children, gap = SPACE.lg }: { children: ReactNode; gap?: string }) {
  return <ul style={{ listStyle: 'none', padding: 0, display: 'grid', gap }}>{children}</ul>;
}

export function DL({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <dl
      style={{
        display: 'grid',
        gridTemplateColumns: 'max-content 1fr',
        columnGap: SPACE.xl,
        rowGap: '0.35rem',
        margin: 0,
        ...style,
      }}
    >
      {children}
    </dl>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <p style={{ color: COLOR.muted }}>{children}</p>;
}

// `warning`, `success` and `danger` draw the same as `pending`, `done` and `problem`.
export type ChipTone =
  'neutral' | 'now' | 'pending' | 'done' | 'problem' | 'warning' | 'success' | 'danger';

const CHIP_COLORS: Record<ChipTone, { border: string; fill: string }> = {
  neutral: { border: COLOR.border, fill: COLOR.surface },
  now: { border: COLOR.accent, fill: COLOR.accentSoft },
  pending: { border: COLOR.warning, fill: COLOR.warningSoft },
  done: { border: COLOR.success, fill: COLOR.successSoft },
  problem: { border: COLOR.danger, fill: COLOR.dangerSoft },
  warning: { border: COLOR.warning, fill: COLOR.warningSoft },
  success: { border: COLOR.success, fill: COLOR.successSoft },
  danger: { border: COLOR.danger, fill: COLOR.dangerSoft },
};

export function StatusChip({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: ChipTone;
}) {
  const { border, fill } = CHIP_COLORS[tone];
  return (
    <span
      style={{
        fontSize: FONT_SIZE.md,
        fontWeight: 'normal',
        border: `1px solid ${border}`,
        borderRadius: RADIUS,
        padding: `${SPACE.hair} ${SPACE.md}`,
        background: fill,
        color: COLOR.text,
        marginLeft: '0.6rem',
        verticalAlign: 'middle',
      }}
    >
      {children}
    </span>
  );
}
