// Queue tables for list pages, and queue cards for Your work, where each desk sees its queues with the oldest item:
// docs/product/requirements.md (R12).
import type { ReactNode } from 'react';

import { TableScroll } from './layout';
import { COLOR, FONT_SIZE, RADIUS, SPACE } from './tokens';

export interface QueueColumn {
  label: ReactNode;
  num?: boolean;

  sort?: 'ascending' | 'descending';
}

const CELL_STYLE = {
  padding: `${SPACE.md} ${SPACE.lg}`,
  borderTop: `1px solid ${COLOR.border}`,
  textAlign: 'left' as const,
  verticalAlign: 'top' as const,
};

export function QueueTable({
  columns,
  caption,
  children,
}: {
  columns: readonly QueueColumn[];
  caption?: ReactNode;
  children: ReactNode;
}) {
  return (
    <TableScroll>
      <table
        style={{
          width: '100%',
          borderCollapse: 'collapse',
          border: `1px solid ${COLOR.border}`,
          borderRadius: RADIUS,
          fontSize: FONT_SIZE.md,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {caption === undefined ? null : (
          <caption
            style={{
              captionSide: 'top',
              textAlign: 'left',
              color: COLOR.muted,
              fontSize: FONT_SIZE.sm,
              paddingBottom: SPACE.md,
            }}
          >
            {caption}
          </caption>
        )}
        <thead>
          <tr>
            {columns.map((column, index) => (
              <th
                key={index}
                aria-sort={column.sort}
                style={{
                  ...CELL_STYLE,
                  borderTop: 0,
                  background: COLOR.surface,
                  color: COLOR.muted,
                  fontSize: FONT_SIZE.sm,
                  fontWeight: 600,
                  textAlign: column.num === true ? 'right' : 'left',
                }}
              >
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </TableScroll>
  );
}

export function QueueCell({ num, children }: { num?: boolean; children?: ReactNode }) {
  return <td style={{ ...CELL_STYLE, textAlign: num === true ? 'right' : 'left' }}>{children}</td>;
}

export function QueueGroupRow({ span, children }: { span: number; children: ReactNode }) {
  return (
    <tr>
      <td
        colSpan={span}
        style={{
          ...CELL_STYLE,
          paddingBlock: SPACE.sm,
          background: COLOR.surface,
          color: COLOR.muted,
          fontSize: FONT_SIZE.sm,
          fontWeight: 700,
        }}
      >
        {children}
      </td>
    </tr>
  );
}

export function RowLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      style={{
        color: COLOR.accent,
        fontWeight: 600,
        textDecoration: 'none',
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </a>
  );
}

const LATE_STYLE = { color: COLOR.warning, fontWeight: 600 };

export function AgeCell({ children, late }: { children: ReactNode; late?: boolean }) {
  return (
    <td
      style={{
        ...CELL_STYLE,
        textAlign: 'right',
        color: COLOR.muted,
        fontSize: FONT_SIZE.sm,
        whiteSpace: 'nowrap',
        ...(late === true ? LATE_STYLE : {}),
      }}
    >
      {children}
    </td>
  );
}

export interface QueueCardFoot {
  text: ReactNode;
  href?: string;
}

export function QueueCard({
  title,
  count,
  foot,
  children,
}: {
  title: ReactNode;
  count?: number;
  foot?: QueueCardFoot;
  children: ReactNode;
}) {
  return (
    <div
      style={{
        border: `1px solid ${COLOR.border}`,
        borderRadius: RADIUS,
        padding: `${SPACE.lg} ${SPACE.xl}`,
        display: 'grid',
        gap: SPACE.md,
        alignContent: 'start',
        background: COLOR.page,
      }}
    >
      <h3
        style={{
          margin: 0,
          fontSize: FONT_SIZE.md,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          gap: SPACE.md,
        }}
      >
        {title}
        {count === undefined ? null : (
          <span
            style={{
              fontSize: FONT_SIZE.xl,
              fontWeight: 700,
              color: count === 0 ? COLOR.muted : COLOR.accent,
            }}
          >
            {count}
          </span>
        )}
      </h3>
      <ul
        style={{
          margin: 0,
          padding: 0,
          listStyle: 'none',
          display: 'grid',
          gap: SPACE.xs,
          fontSize: FONT_SIZE.sm,
        }}
      >
        {children}
      </ul>
      {foot === undefined ? null : foot.href === undefined ? (
        <p style={{ margin: 0, fontSize: FONT_SIZE.sm, color: COLOR.muted }}>{foot.text}</p>
      ) : (
        <a href={foot.href} style={{ fontSize: FONT_SIZE.sm, color: COLOR.accent }}>
          {foot.text}
        </a>
      )}
    </div>
  );
}

export function QueueCardRow({
  href,
  children,
  age,
  late,
}: {
  href: string;
  children: ReactNode;
  age?: ReactNode;
  late?: boolean;
}) {
  return (
    <li style={{ display: 'flex', justifyContent: 'space-between', gap: SPACE.md }}>
      <a href={href} style={{ color: COLOR.accent, textDecoration: 'none' }}>
        {children}
      </a>
      {age === undefined ? null : (
        <span style={{ whiteSpace: 'nowrap', ...(late === true ? LATE_STYLE : {}) }}>{age}</span>
      )}
    </li>
  );
}

/** A count beside a menu item in the top bar. Draws nothing at zero. */
export function CountBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span
      style={{
        display: 'inline-block',
        minWidth: '1.25rem',
        padding: `0 ${SPACE.sm}`,
        marginLeft: SPACE.xs,
        borderRadius: 10,
        background: COLOR.accentSoft,
        color: COLOR.text,
        fontSize: FONT_SIZE.xs,
        textAlign: 'center',
      }}
    >
      {count}
    </span>
  );
}
