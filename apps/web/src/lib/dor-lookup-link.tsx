// Puts a link to the state's sales tax code lookup under a tax jurisdiction box, so Sales can find the code for an address.
// A plain anchor in a new tab with no referrer. apps/web/src/lib/dor-lookup.test.ts names the boxes that must carry it.
import type { ReactNode } from 'react';

import { COLOR, FONT_SIZE, SPACE } from '@erp/ui';

import { DOR_LOOKUP_URL, DOR_LOOKUP_WORDS } from './dor-lookup';

export function WithDorLookup({ children }: { children: ReactNode }) {
  return (
    <div style={{ display: 'grid', gap: SPACE.hair, justifyItems: 'start' }}>
      {children}
      <a
        href={DOR_LOOKUP_URL}
        target="_blank"
        rel="noopener noreferrer"
        style={{ fontSize: FONT_SIZE.xs, color: COLOR.accent }}
      >
        {DOR_LOOKUP_WORDS}
      </a>
    </div>
  );
}
