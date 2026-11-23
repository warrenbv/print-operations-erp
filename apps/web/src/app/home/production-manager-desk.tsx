// The Production Manager's section on Your work: orders to confirm and quotes needing a lead time.
import { Section } from '@erp/ui';

import type { Desk } from '../../lib/work/desks';
import type { DeskCards as Cards } from './cards';
import { DeskCards } from './desk-cards';

export function ProductionManagerDesk({ desk, cards }: { desk: Desk; cards: Cards }) {
  return (
    <Section title="Orders and quotes">
      <DeskCards desk={desk} cards={cards.cards} />
    </Section>
  );
}
