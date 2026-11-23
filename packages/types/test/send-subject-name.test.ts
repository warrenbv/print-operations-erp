// Tests for how a send names its subject.
import { describe, expect, it } from 'vitest';

import { shortId } from '../src/identifier';
import { labelledSendSubjectSchema, orderSubjectLabel, sendSubjectName } from '../src/send-log';

const ID = '01a021c1-8a26-70d1-9b9b-3f37b17d8b01';

describe('sendSubjectName', () => {
  it.each([
    ['quote', 'Q-00318', 'Quote Q-00318'],
    ['quote', 'Q-00318 v2', 'Quote Q-00318 v2'],
    ['order', 'DPW-04718', 'Order DPW-04718'],
  ] as const)('names a %s by its label: %s', (type, label, named) => {
    expect(sendSubjectName(type, ID, label)).toBe(named);
  });

  it('falls back to the id tail when a row carries no label', () => {
    expect(sendSubjectName('quote', ID)).toBe(`Quote ${shortId(ID)}`);
    expect(sendSubjectName('order', ID)).toBe(`Order ${shortId(ID)}`);
  });
});

describe('orderSubjectLabel', () => {
  it('is the job number once there is one', () => {
    expect(orderSubjectLabel({ id: ID, jobNumber: 'DPW-04718' })).toBe('DPW-04718');
  });

  it('is the id tail before confirmation, as every screen shows such an order', () => {
    expect(orderSubjectLabel({ id: ID })).toBe(shortId(ID));
  });
});

describe('labelledSendSubjectSchema', () => {
  it('refuses a blank label, as the table does', () => {
    expect(
      labelledSendSubjectSchema.safeParse({ type: 'quote', id: ID, label: '  ' }).success,
    ).toBe(false);
  });
});
