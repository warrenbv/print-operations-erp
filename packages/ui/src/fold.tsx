// A named fold for rarely needed fields and sections, such as a quote line's More options:
// docs/product/requirements.md (R3). It is a native details element, so it needs no client script:
// docs/decisions/004-server-first-web-ui.md. Its glyph rules live in `THEME_STYLE` in packages/ui/src/tokens.ts.
import type { ReactNode } from 'react';

import { COLOR, FOLD_CLASS, FONT_SIZE, RADIUS, SPACE } from './tokens';

export function Fold({
  summary,
  sum,
  open,
  children,
}: {
  summary: ReactNode;

  sum?: ReactNode;
  open?: boolean;
  children: ReactNode;
}) {
  return (
    <details
      className={FOLD_CLASS.fold}
      open={open === true}
      style={{ border: `1px solid ${COLOR.border}`, borderRadius: RADIUS }}
    >
      <summary
        className={FOLD_CLASS.bar}
        style={{
          cursor: 'pointer',
          padding: `${SPACE.md} ${SPACE.lg}`,
          fontWeight: 600,
          listStyle: 'none',
          display: 'flex',
          justifyContent: 'space-between',
          gap: SPACE.lg,
        }}
      >
        {summary}
        {sum === undefined ? null : (
          <span
            style={{
              fontWeight: 400,
              color: COLOR.muted,
              fontSize: FONT_SIZE.sm,
              marginLeft: 'auto',
            }}
          >
            {sum}
          </span>
        )}
        <span aria-hidden="true" className={FOLD_CLASS.closedGlyph} style={{ color: COLOR.muted }}>
          {'▾'}
        </span>
        <span aria-hidden="true" className={FOLD_CLASS.openGlyph} style={{ color: COLOR.muted }}>
          {'▴'}
        </span>
      </summary>
      <div
        style={{
          padding: `${SPACE.xs} ${SPACE.lg} ${SPACE.lg}`,
          borderTop: `1px solid ${COLOR.border}`,
          display: 'grid',
          gap: SPACE.md,
        }}
      >
        {children}
      </div>
    </details>
  );
}
