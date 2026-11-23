// The Billing Manager's section on Your work.
import { Section } from '@erp/ui';

import type { Desk } from '../../lib/work/desks';
import type { DeskCards as Cards } from './cards';
import { DeskCards } from './desk-cards';

export function BillingDesk({ desk, cards }: { desk: Desk; cards: Cards }) {
  return (
    <Section title="Decisions">
      <DeskCards desk={desk} cards={cards.cards} />
    </Section>
  );
}
