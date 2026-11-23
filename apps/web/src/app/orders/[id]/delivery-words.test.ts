// Tests the words for estimated freight.
import type { FreightResult } from '@erp/types';
import { describe, expect, it } from 'vitest';

import { estimatedFreightWords } from './delivery-words';

const result = (fields: Partial<FreightResult>): FreightResult => ({
  mode: 'carrier',
  cost: '100.0000',
  margin: '37.0000',
  invoiceTotal: '137.0000',
  pending: false,
  ...fields,
});

describe('estimatedFreightWords', () => {
  it('reads a known estimate as the mode and the amount', () => {
    expect(estimatedFreightWords(result({}))).toEqual({ mode: 'Freight', amount: '$137.00' });
  });

  it('says freight TBD for a line whose bid is not in, never $0.00', () => {
    const pending = result({ invoiceTotal: '0.0000', pending: true });

    expect(estimatedFreightWords(pending)).toEqual({ mode: 'Freight', tbd: 'freight TBD' });
  });

  it('reads the known warehouse leg of a pass-thru line, and the last leg to come', () => {
    const partial = result({ mode: 'pass_through', invoiceTotal: '64.0000', pending: true });

    expect(estimatedFreightWords(partial)).toEqual({
      mode: 'Pass-thru',
      amount: '$64.00',
      tbd: '+ last leg TBD',
    });
  });
});
