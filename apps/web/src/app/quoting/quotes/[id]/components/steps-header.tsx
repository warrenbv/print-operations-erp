// The four-step header of quote entry, from apps/web/src/app/quoting/quotes/[id]/steps.ts.
import type { CSSProperties } from 'react';

import { COLOR, FONT_SIZE, RADIUS, SPACE } from '@erp/ui';

import type { QuoteStep } from '../steps';

export function StepsHeader({ steps }: { steps: readonly QuoteStep[] }) {
  return (
    <nav
      aria-label="Quote steps"
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        border: `1px solid ${COLOR.border}`,
        borderRadius: RADIUS,
        overflow: 'hidden',
        margin: `${SPACE.lg} 0`,
      }}
    >
      {steps.map((step, i) => {
        const last = i === steps.length - 1;
        const content = (
          <>
            {step.done && (
              <span aria-hidden="true" style={{ color: COLOR.success }}>
                {'✓ '}
              </span>
            )}
            {`${String(step.number)}. ${step.label}`}
            <small style={SUMMARY_STYLE}>{step.summary}</small>
          </>
        );
        const style = cellStyle(step.state === 'current', last);
        return step.href === undefined ? (
          <span
            key={step.number}
            aria-current={step.state === 'current' ? 'step' : undefined}
            style={style}
          >
            {content}
          </span>
        ) : (
          <a key={step.number} href={step.href} style={style}>
            {content}
          </a>
        );
      })}
    </nav>
  );
}

function cellStyle(current: boolean, last: boolean): CSSProperties {
  return {
    flex: '1 1 10rem',
    padding: `${SPACE.md} ${SPACE.lg}`,
    textDecoration: 'none',
    color: COLOR.text,
    fontWeight: current ? 700 : 400,
    borderRight: last ? undefined : `1px solid ${COLOR.border}`,
    ...(current
      ? { background: COLOR.accentSoft, boxShadow: `inset 0 -3px 0 ${COLOR.accent}` }
      : {}),
  };
}

const SUMMARY_STYLE: CSSProperties = {
  display: 'block',
  fontWeight: 400,
  color: COLOR.muted,
  fontSize: FONT_SIZE.xs,
};
