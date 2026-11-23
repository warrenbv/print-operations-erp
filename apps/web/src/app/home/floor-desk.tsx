// The Production section on Your work: quotes needing a lead time.
import { Section } from '@erp/ui';

import type { Desk } from '../../lib/work/desks';
import type { DeskCards as Cards } from './cards';
import { DeskCards } from './desk-cards';

export function FloorDesk({ desk, cards }: { desk: Desk; cards: Cards }) {
  return (
    <Section title="Lead times">
      <DeskCards desk={desk} cards={cards.cards} />
    </Section>
  );
}
