// The quiet text of a page: the lede under a title, notes under sections, data lines and explainers a reader opens.
import type { ReactNode } from 'react';

import { rendersNothing } from './banners';
import { COLOR, FONT_SIZE, MEASURE, SPACE } from './tokens';

export function PageLede({ children }: { children?: ReactNode }) {
  if (rendersNothing(children)) return null;
  return (
    <p
      style={{
        color: COLOR.muted,
        fontSize: FONT_SIZE.md,
        margin: `${SPACE.xs} 0 ${SPACE.xl}`,
        maxWidth: MEASURE.lede,
      }}
    >
      {children}
    </p>
  );
}

export function SectionNote({ children }: { children?: ReactNode }) {
  if (rendersNothing(children)) return null;
  return (
    <p
      style={{
        color: COLOR.muted,
        fontSize: FONT_SIZE.sm,
        margin: `0 0 ${SPACE.lg}`,
        maxWidth: MEASURE.note,
      }}
    >
      {children}
    </p>
  );
}

export const DATA_LINE_STYLE = {
  color: COLOR.muted,
  fontSize: FONT_SIZE.sm,
  margin: `0 0 ${SPACE.lg}`,
} as const;

export function DataLine({ children }: { children?: ReactNode }) {
  if (rendersNothing(children)) return null;
  return <p style={DATA_LINE_STYLE}>{children}</p>;
}

export function Explainer({ summary, children }: { summary: ReactNode; children: ReactNode }) {
  return (
    <details>
      <summary style={{ color: COLOR.muted, fontSize: FONT_SIZE.sm, cursor: 'pointer' }}>
        {summary}
      </summary>
      <div
        style={{
          color: COLOR.text,
          fontSize: FONT_SIZE.sm,
          maxWidth: MEASURE.note,
          padding: `${SPACE.sm} 0 0 ${SPACE.lg}`,
        }}
      >
        {children}
      </div>
    </details>
  );
}
