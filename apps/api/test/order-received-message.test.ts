// Tests the wording of the new-order alert built in apps/api/src/orders/orders.factory.ts.
import { shortId } from '@erp/types';
import { describe, expect, it } from 'vitest';

import { orderPagePath, orderReceivedMessage } from '../src/orders/orders.factory';

const ID = '01a11770-b39e-7c2a-9d1e-5f0a3b6c7d8e';
const BASE = 'https://erp.example.test';

describe('orderReceivedMessage', () => {
  it('names the order by its quote and links to the order page', () => {
    const message = orderReceivedMessage(
      { id: ID, poNumber: 'PO-5480' },
      { customerName: 'Acme Paper', quoteRef: 'Q-00731', webBaseUrl: BASE },
    );
    expect(message.subject).toBe(
      'New order to confirm: Order from Q-00731 for Acme Paper (PO PO-5480)',
    );
    expect(message.textBody).toBe(
      [
        'A new order came in: Order from Q-00731 for Acme Paper (PO PO-5480).',
        '',
        'Confirm material and lead time to release it to production.',
        '',
        `Open the order: ${BASE}/orders/${ID}`,
        '',
      ].join('\n'),
    );
  });

  it('says nothing about a PO on a verbal order', () => {
    const message = orderReceivedMessage(
      { id: ID },
      { customerName: 'Acme Paper', quoteRef: 'Q-00731', webBaseUrl: BASE },
    );
    expect(message.subject).toBe('New order to confirm: Order from Q-00731 for Acme Paper');
    expect(message.textBody.split('\n')[0]).toBe(
      'A new order came in: Order from Q-00731 for Acme Paper.',
    );
    expect(`${message.subject}${message.textBody}`).not.toContain('PO');
  });

  it('names a revised quote by its version, as every screen does', () => {
    const message = orderReceivedMessage(
      { id: ID },
      { customerName: 'Acme Paper', quoteRef: 'Q-00731 v2', webBaseUrl: BASE },
    );
    expect(message.subject).toBe('New order to confirm: Order from Q-00731 v2 for Acme Paper');
  });

  it('names the page in words when the ERP has not been told its address', () => {
    const message = orderReceivedMessage(
      { id: ID },
      { customerName: 'Acme Paper', quoteRef: 'Q-00731', webBaseUrl: undefined },
    );

    expect(message.textBody).toContain('Open it from Orders, under Production.');
    expect(message.textBody).not.toContain('http');
  });

  it('falls back to the id tail when the quote cannot be read', () => {
    const message = orderReceivedMessage(
      { id: ID },
      { customerName: 'Acme Paper', quoteRef: undefined, webBaseUrl: BASE },
    );
    expect(message.subject).toBe(`New order to confirm: Order ${shortId(ID)} for Acme Paper`);
  });

  it('never shows the raw id or a dash outside the link', () => {
    for (const poNumber of [undefined, 'PO-9']) {
      const message = orderReceivedMessage(
        { id: ID, ...(poNumber === undefined ? {} : { poNumber }) },
        { customerName: 'Acme Paper', quoteRef: 'Q-00731', webBaseUrl: undefined },
      );
      const text = `${message.subject}\n${message.textBody}`;
      expect(text).not.toContain(ID);

      expect(text).not.toMatch(/[–—]| - /);
    }
  });
});

describe('orderPagePath', () => {
  it('is exactly the web app order route', () => {
    expect(orderPagePath(ID)).toBe(`/orders/${ID}`);
  });
});
