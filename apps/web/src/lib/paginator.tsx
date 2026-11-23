// Previous and Next links for a paged list. Plain anchors, so every page is a full server render: docs/decisions/004-server-first-web-ui.md.
// The arithmetic is in apps/web/src/lib/paging.ts.
import { COLOR, FONT_SIZE, PRINT_CLASS, SPACE } from '@erp/ui';

import { DEFAULT_PAGE_KEY, hasNextPage, hasPreviousPage, pageHref, type Paging } from './paging';

export function Paginator({
  basePath,
  params,
  paging,
  total,
  pageKey = DEFAULT_PAGE_KEY,
}: {
  basePath: string;
  params: Readonly<Record<string, string | undefined>>;
  paging: Paging;
  total: number;
  pageKey?: string;
}) {
  const previous = hasPreviousPage(paging);
  const next = hasNextPage(paging, total);
  if (!previous && !next) return null;

  return (
    <nav
      aria-label="Pages"
      className={PRINT_CLASS.hide}
      style={{ display: 'flex', gap: SPACE.lg, margin: `${SPACE.xl} 0`, fontSize: FONT_SIZE.sm }}
    >
      {previous ? (
        <a
          href={pageHref(basePath, params, paging.page - 1, pageKey)}
          style={{ color: COLOR.accent }}
        >
          ← Previous
        </a>
      ) : (
        <span style={{ color: COLOR.muted }}>← Previous</span>
      )}
      {next ? (
        <a
          href={pageHref(basePath, params, paging.page + 1, pageKey)}
          style={{ color: COLOR.accent }}
        >
          Next →
        </a>
      ) : (
        <span style={{ color: COLOR.muted }}>Next →</span>
      )}
    </nav>
  );
}
