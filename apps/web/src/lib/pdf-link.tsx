// A link that opens a PDF in a new tab, used by apps/web/src/app/quoting/quotes/[id]/review/customer-copy-section.tsx.
import type { ReactNode } from 'react';

import { COLOR } from '@erp/ui';

export function PdfLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener" style={{ color: COLOR.accent }}>
      {children}
    </a>
  );
}
