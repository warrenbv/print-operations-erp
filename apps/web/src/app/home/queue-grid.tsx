// The responsive grid the queue cards sit in.
import type { ReactNode } from 'react';

import { SPACE } from '@erp/ui';

export function QueueGrid({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
        gap: SPACE.md,
      }}
    >
      {children}
    </div>
  );
}
