// The Sales section on Your work, with the way to start a quote. A quote starts from the customer:
// docs/product/requirements.md (R1).
import { COLOR, FONT_SIZE, LinkButton, SPACE, Section } from '@erp/ui';

import type { Desk } from '../../lib/work/desks';
import type { DeskCards as Cards } from './cards';
import { DeskCards } from './desk-cards';

export function SalesDesk({ desk, cards }: { desk: Desk; cards: Cards }) {
  return (
    <Section title="Quotes and orders">
      <DeskCards desk={desk} cards={cards.cards} />
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: SPACE.md,
          marginTop: SPACE.lg,
        }}
      >
        <LinkButton href="/quoting/quotes/new" variant="primary">
          New quote
        </LinkButton>
        <LinkButton href="/crm/customers">Find a customer</LinkButton>
        <span style={{ color: COLOR.muted, fontSize: FONT_SIZE.sm }}>
          A new quote starts with picking the customer.
        </span>
      </div>
    </Section>
  );
}
