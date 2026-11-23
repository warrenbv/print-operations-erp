// Tests the shared help sentences against the wording the pages use.
import { describe, expect, it } from 'vitest';

import {
  ATTACHING_ADDS_A_FILE,
  CARRIER_BID_HINT,
  CREDIT_HOLD_SENTENCE,
  DEFAULT_TAX_JURISDICTION_HINT,
  DELIVERY_DATE_REFUSAL,
  FREIGHT_MARGIN_PERCENT_HINT,
  nobodyTagged,
  ONLY_SALES_STARTS_A_QUOTE,
  onlyDesk,
  RATE_OVERRIDE_HINT,
  RECEIVED_DOCUMENT_HINT,
  SHARED_MAILBOX_HINT,
  WASHINGTON_JURISDICTION_HINT,
} from './helptext';

describe('onlyDesk', () => {
  it('names the desk and the act in one fixed sentence', () => {
    expect(onlyDesk('the Billing Manager', 'loads a quarter')).toBe(
      'Only the Billing Manager loads a quarter.',
    );
    expect(onlyDesk('Sales', 'raises a quote')).toBe('Only Sales raises a quote.');
  });
});

describe('ONLY_SALES_STARTS_A_QUOTE', () => {
  it('reads as the quote list and the new-quote page say it', () => {
    expect(ONLY_SALES_STARTS_A_QUOTE).toBe('Only Sales starts a quote.');
  });
});

describe('CREDIT_HOLD_SENTENCE', () => {
  it('reads as the pages say it', () => {
    expect(CREDIT_HOLD_SENTENCE).toBe(
      'On credit hold. No quote can be created for this account until the Billing Manager approves it.',
    );
  });
});

describe('nobodyTagged', () => {
  it('names the document and the tag to tick', () => {
    expect(nobodyTagged('order confirmations', 'Order confirmation')).toBe(
      'Nobody on this account is tagged to receive order confirmations, so there is nobody to send it to. ' +
        'Open the customer, edit the contact who should get them, and tick Order confirmation.',
    );
  });
});

describe('the attach hint', () => {
  it('reads as the order and convert pages say it', () => {
    expect(ATTACHING_ADDS_A_FILE).toBe('Adds a file. It never replaces one.');
  });
});

describe('RECEIVED_DOCUMENT_HINT', () => {
  it('reads as both attach forms say it under the file box, within the hint budget', () => {
    expect(RECEIVED_DOCUMENT_HINT).toBe('PDF, image, Word or Excel, up to 25 MB.');
    expect(RECEIVED_DOCUMENT_HINT.split(/\s+/).length).toBeLessThanOrEqual(15);
  });
});

describe('WASHINGTON_JURISDICTION_HINT', () => {
  it('reads as both quote steps say it, within the hint budget', () => {
    expect(WASHINGTON_JURISDICTION_HINT).toBe(
      'Washington needs WA- and the four-digit DOR code, such as WA-0202.',
    );

    expect(WASHINGTON_JURISDICTION_HINT.split(/\s+/).length).toBeLessThanOrEqual(15);
  });
});

describe('DEFAULT_TAX_JURISDICTION_HINT', () => {
  it('reads as the customer form says it, within the hint budget', () => {
    expect(DEFAULT_TAX_JURISDICTION_HINT).toBe(
      'ID, or WA- and the four-digit DOR location code, such as WA-0202 for Clarkston.',
    );
    expect(DEFAULT_TAX_JURISDICTION_HINT.split(/\s+/).length).toBeLessThanOrEqual(15);
  });
});

describe('SHARED_MAILBOX_HINT', () => {
  it('reads as both contact forms say it', () => {
    expect(SHARED_MAILBOX_HINT).toBe(
      'Leave blank for a shared mailbox. Its email shows in its place.',
    );
  });
});

describe('the quote line freight hints', () => {
  it('read as the Lines step and Delivery and tax say them', () => {
    expect(RATE_OVERRIDE_HINT).toBe('Blank uses the configured rate.');
    expect(CARRIER_BID_HINT).toBe('Blank until the bid arrives.');
    expect(FREIGHT_MARGIN_PERCENT_HINT).toBe('12 means 12 percent.');
  });
});

describe('DELIVERY_DATE_REFUSAL', () => {
  it('reads as Create orders says it', () => {
    expect(DELIVERY_DATE_REFUSAL).toBe(
      'Enter the delivery date as a calendar date, like 2026-09-14.',
    );
  });
});
