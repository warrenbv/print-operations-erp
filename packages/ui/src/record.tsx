// The parts of a record page around the Act now panel: head, step strip, key-value list, line summaries, folds and
// rare acts. The step strip shows where a quote or order stands: docs/product/requirements.md (R12).
// The narrow-screen layout lives in `THEME_STYLE` in packages/ui/src/tokens.ts.
import type { CSSProperties, ReactNode } from 'react';

import { PageLede } from './helptext';
import { Box, type ChipTone, StatusChip } from './layout';
import { COLOR, FONT_SIZE, RADIUS, RECORD_CLASS, SPACE } from './tokens';

// `gated` is a step held by a condition, named in its note. `na` is a step this record does not take.
export type StripState = 'done' | 'current' | 'gated' | 'todo' | 'na';

export interface StripStep {
  readonly label: string;
  readonly state: StripState;

  readonly note?: string | undefined;

  readonly href?: string | undefined;
}

export interface CrumbItem {
  readonly label: string;
  readonly href?: string | undefined;
}

export interface RecordChip {
  readonly label: string;
  readonly tone: ChipTone;
}

const STRIP_STATE: Record<StripState, CSSProperties> = {
  todo: { borderColor: COLOR.border, background: COLOR.surface, color: COLOR.muted },
  done: { borderColor: COLOR.success, background: COLOR.successSoft, color: COLOR.muted },
  current: { borderColor: COLOR.accent, background: COLOR.accentSoft, color: COLOR.text },
  gated: { borderColor: COLOR.warning, background: COLOR.warningSoft, color: COLOR.muted },
  na: { borderColor: COLOR.border, background: COLOR.surface, color: COLOR.muted, opacity: 0.55 },
};

export function StepStrip({
  steps,
  label = 'Step strip',
}: {
  steps: readonly StripStep[];
  label?: string;
}) {
  return (
    <nav aria-label={label}>
      <ol
        className={RECORD_CLASS.strip}
        style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: SPACE.xs }}
      >
        {steps.map((step) => {
          const words = (
            <>
              <span
                style={{
                  display: 'block',
                  fontWeight: 700,
                  color: step.state === 'current' ? COLOR.accent : COLOR.text,
                }}
              >
                {step.state === 'done' && (
                  <span aria-hidden="true" style={{ color: COLOR.success }}>
                    {'✓ '}
                  </span>
                )}
                {step.label}
              </span>
              {step.note}
            </>
          );
          return (
            <li
              key={step.label}
              aria-current={step.state === 'current' ? 'step' : undefined}
              style={{
                position: 'relative',
                padding: `${SPACE.md} ${SPACE.lg}`,
                borderRadius: RADIUS,
                fontSize: FONT_SIZE.sm,
                minWidth: 0,
                borderWidth: 1,
                borderStyle: 'solid',
                ...STRIP_STATE[step.state],
              }}
            >
              {step.href === undefined ? (
                words
              ) : (
                <a
                  href={step.href}
                  style={{ color: 'inherit', textDecoration: 'none', display: 'block' }}
                >
                  {words}
                </a>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export function Crumb({ items }: { items: readonly CrumbItem[] }) {
  if (items.length === 0) return null;
  return (
    <nav aria-label="Breadcrumb">
      <p style={{ fontSize: FONT_SIZE.sm, margin: 0 }}>
        {items.map((item, index) => (
          <span key={`${String(index)}-${item.label}`}>
            {index > 0 && ' / '}
            {item.href === undefined ? (
              item.label
            ) : (
              <a href={item.href} style={{ color: COLOR.accent, textDecoration: 'none' }}>
                {item.label}
              </a>
            )}
          </span>
        ))}
      </p>
    </nav>
  );
}

export function RecordHead({
  crumb,
  title,
  chip,
  lede,
}: {
  crumb?: readonly CrumbItem[] | undefined;
  title: string;
  chip?: RecordChip | undefined;
  lede?: ReactNode;
}) {
  return (
    <div style={{ display: 'grid', gap: SPACE.sm }}>
      {crumb !== undefined && <Crumb items={crumb} />}

      <div
        style={{ display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', gap: `${SPACE.xs} 0` }}
      >
        <h1 style={{ margin: 0 }}>{title}</h1>
        {chip !== undefined && <StatusChip tone={chip.tone}>{chip.label}</StatusChip>}
      </div>
      <PageLede>{lede}</PageLede>
    </div>
  );
}

export function KV({ children }: { children: ReactNode }) {
  return (
    <dl
      className={RECORD_CLASS.kv}
      style={{ display: 'grid', gap: `${SPACE.sm} ${SPACE.xl}`, margin: 0 }}
    >
      {children}
    </dl>
  );
}

export function LineSummary({
  id,
  spec,
  delivery,
  price,
  note,
  edit,
}: {
  id?: string | undefined;
  spec: string;
  delivery: string;
  price: ReactNode;
  note: ReactNode;
  edit?: { href: string; label: string } | undefined;
}) {
  return (
    <Box style={{ background: COLOR.surface }}>
      <div
        id={id}
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) auto auto',
          gap: `${SPACE.sm} ${SPACE.lg}`,
          alignItems: 'baseline',
        }}
      >
        <span style={{ fontWeight: 600 }}>{spec}</span>
        <span>{delivery}</span>
        <span style={{ fontVariantNumeric: 'tabular-nums' }}>{price}</span>
      </div>
      <p style={{ margin: 0, fontSize: FONT_SIZE.sm, color: COLOR.muted }}>
        {note}
        {edit !== undefined && (
          <>
            {' '}
            <a href={edit.href}>{edit.label}</a>
          </>
        )}
      </p>
    </Box>
  );
}

export function FoldGroup({ children }: { children: ReactNode }) {
  return <div style={{ display: 'grid', gap: SPACE.md, marginTop: SPACE.xxl }}>{children}</div>;
}

/** The foot of a record page, under Rarely needed, for acts most readers never take: docs/product/ux-direction.md. */
export function RareActs({ children }: { children: ReactNode }) {
  return (
    <section
      style={{
        borderTop: `1px solid ${COLOR.border}`,
        paddingTop: SPACE.xl,
        marginTop: SPACE.xxl,
        display: 'grid',
        gap: SPACE.lg,
      }}
    >
      <h2 style={{ fontSize: FONT_SIZE.md, color: COLOR.muted, margin: 0 }}>Rarely needed</h2>
      {children}
    </section>
  );
}
