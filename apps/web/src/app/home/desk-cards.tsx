// Draws one desk's queues as cards, in the order apps/web/src/lib/work/desks.ts lists them.
// An empty queue still shows, so a desk always sees its whole list.
import { COLOR, QueueCard, QueueCardRow } from '@erp/ui';

import type { Desk } from '../../lib/work/desks';
import type { CardBody } from './cards';
import { QueueGrid } from './queue-grid';

export function DeskCards({
  desk,
  cards,
}: {
  desk: Desk;
  cards: Readonly<Record<string, CardBody>>;
}) {
  return (
    <QueueGrid>
      {desk.queues.map((queue) => {
        const body = cards[queue.id] ?? { count: 0, rows: [] };
        return (
          <QueueCard key={queue.id} title={queue.title} count={body.count} foot={body.foot}>
            {body.rows.length === 0 ? (
              <li style={{ color: COLOR.muted }}>Nothing waiting.</li>
            ) : (
              body.rows.map((row) => (
                <QueueCardRow
                  key={`${row.href} ${row.text}`}
                  href={row.href}
                  age={row.age}
                  late={row.late}
                >
                  {row.text}
                </QueueCardRow>
              ))
            )}
          </QueueCard>
        );
      })}
    </QueueGrid>
  );
}
