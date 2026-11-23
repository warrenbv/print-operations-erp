// Tests freight by shipping mode, including pending carrier bids and the freight margin:
// docs/product/requirements.md (R4). Subject: modules/quoting/src/freight.ts.
import { freightKnowledge } from '@erp/types';
import { describe, expect, it } from 'vitest';

import { calculateFreight } from '../src/freight';

const config = { ourVehicleFreightRate: '31.5000' };

describe('calculateFreight — pickup', () => {
  it('yields zero cost, margin, and invoice total', () => {
    expect(calculateFreight({ mode: 'pickup' }, config)).toEqual({
      mode: 'pickup',
      cost: '0.0000',
      margin: '0.0000',
      invoiceTotal: '0.0000',
      pending: false,
    });
  });
});

describe('calculateFreight — our_vehicle', () => {
  it('uses the pricing_config rate when no override is given', () => {
    expect(calculateFreight({ mode: 'our_vehicle' }, config)).toEqual({
      mode: 'our_vehicle',
      cost: '31.5000',
      margin: '0.0000',
      invoiceTotal: '31.5000',
      pending: false,
    });
  });

  it('honors the per-order rate override', () => {
    expect(calculateFreight({ mode: 'our_vehicle', rateOverride: '46.2500' }, config)).toEqual({
      mode: 'our_vehicle',
      cost: '46.2500',
      margin: '0.0000',
      invoiceTotal: '46.2500',
      pending: false,
    });
  });
});

describe('calculateFreight — pass_through', () => {
  it('adds the last-leg bid to the our_vehicle rate, at cost', () => {
    expect(calculateFreight({ mode: 'pass_through', carrierBid: '57.7500' }, config)).toEqual({
      mode: 'pass_through',
      cost: '89.2500',
      margin: '0.0000',
      invoiceTotal: '89.2500',
      pending: false,
    });
  });

  it('honors a rate override on the warehouse leg', () => {
    expect(
      calculateFreight(
        { mode: 'pass_through', rateOverride: '38.7500', carrierBid: '57.7500' },
        config,
      ),
    ).toEqual({
      mode: 'pass_through',
      cost: '96.5000',
      margin: '0.0000',
      invoiceTotal: '96.5000',
      pending: false,
    });
  });
});

describe('calculateFreight — pass_through with the last-leg bid still outstanding', () => {
  it('carries the flat warehouse leg and reports pending when no bid has arrived', () => {
    expect(calculateFreight({ mode: 'pass_through' }, config)).toEqual({
      mode: 'pass_through',
      cost: '31.5000',
      margin: '0.0000',
      invoiceTotal: '31.5000',
      pending: true,
    });
  });

  it('honors a rate override on the known leg while still pending', () => {
    expect(calculateFreight({ mode: 'pass_through', rateOverride: '38.7500' }, config)).toEqual({
      mode: 'pass_through',
      cost: '38.7500',
      margin: '0.0000',
      invoiceTotal: '38.7500',
      pending: true,
    });
  });

  it('stays at cost — an outstanding leg never acquires a margin', () => {
    expect(calculateFreight({ mode: 'pass_through' }, config).margin).toEqual('0.0000');
  });

  it('is distinguishable from a pending mode-4 line, which knows nothing', () => {
    const modeThree = calculateFreight({ mode: 'pass_through' }, config);
    const modeFour = calculateFreight({ mode: 'carrier' }, config);

    expect(modeThree.pending).toBe(true);
    expect(modeFour.pending).toBe(true);
    expect(modeThree.invoiceTotal).toEqual('31.5000');
    expect(modeFour.invoiceTotal).toEqual('0.0000');
    expect(freightKnowledge(modeThree)).toBe('partial');
    expect(freightKnowledge(modeFour)).toBe('unknown');
  });

  it('is distinguishable from a fully-priced pass_through line', () => {
    const priced = calculateFreight({ mode: 'pass_through', carrierBid: '57.7500' }, config);

    expect(priced.pending).toBe(false);
    expect(freightKnowledge(priced)).toBe('known');
  });

  it('understates rather than overstates while the last leg is outstanding', () => {
    const outstanding = calculateFreight({ mode: 'pass_through' }, config);
    const resolved = calculateFreight({ mode: 'pass_through', carrierBid: '57.7500' }, config);

    expect(Number(outstanding.invoiceTotal)).toBeLessThan(Number(resolved.invoiceTotal));
  });

  it('resolves to a real figure once the bid is entered after weighing', () => {
    const resolved = calculateFreight({ mode: 'pass_through', carrierBid: '57.7500' }, config);

    expect(resolved.pending).toBe(false);
    expect(resolved.invoiceTotal).toEqual('89.2500');
  });
});

describe('freightKnowledge', () => {
  it('reports known for every mode that has all its numbers', () => {
    expect(freightKnowledge(calculateFreight({ mode: 'pickup' }, config))).toBe('known');
    expect(freightKnowledge(calculateFreight({ mode: 'our_vehicle' }, config))).toBe('known');
    expect(
      freightKnowledge(calculateFreight({ mode: 'pass_through', carrierBid: '57.7500' }, config)),
    ).toBe('known');
    expect(
      freightKnowledge(calculateFreight({ mode: 'carrier', carrierBid: '250.0000' }, config)),
    ).toBe('known');
  });

  it('separates the two ways a figure can be outstanding', () => {
    expect(freightKnowledge(calculateFreight({ mode: 'pass_through' }, config))).toBe('partial');
    expect(freightKnowledge(calculateFreight({ mode: 'carrier' }, config))).toBe('unknown');
  });

  it('never reports pickup as unknown, though both are $0.00', () => {
    const free = calculateFreight({ mode: 'pickup' }, config);
    const unmeasured = calculateFreight({ mode: 'carrier' }, config);

    expect(free.invoiceTotal).toEqual(unmeasured.invoiceTotal);
    expect(freightKnowledge(free)).toBe('known');
    expect(freightKnowledge(unmeasured)).toBe('unknown');
  });
});

describe('calculateFreight — carrier', () => {
  it('is exact cost when the customer has no freight-margin agreement', () => {
    expect(calculateFreight({ mode: 'carrier', carrierBid: '250.0000' }, config)).toEqual({
      mode: 'carrier',
      cost: '250.0000',
      margin: '0.0000',
      invoiceTotal: '250.0000',
      pending: false,
    });
  });

  it("marks up by the customer's freight margin when set", () => {
    expect(
      calculateFreight(
        { mode: 'carrier', carrierBid: '250.0000', freightMarginPct: '0.120000' },
        config,
      ),
    ).toEqual({
      mode: 'carrier',
      cost: '250.0000',
      margin: '34.0909',
      invoiceTotal: '284.0909',
      pending: false,
    });
  });

  it('handles a zero-margin customer identically to no margin at all', () => {
    const explicit = calculateFreight(
      { mode: 'carrier', carrierBid: '250.0000', freightMarginPct: '0.000000' },
      config,
    );
    const absent = calculateFreight({ mode: 'carrier', carrierBid: '250.0000' }, config);
    expect(explicit).toEqual(absent);
  });

  it('handles a zero bid — a booked-empty run with a margin still applies', () => {
    expect(
      calculateFreight(
        { mode: 'carrier', carrierBid: '0.0000', freightMarginPct: '0.120000' },
        config,
      ),
    ).toEqual({
      mode: 'carrier',
      cost: '0.0000',
      margin: '0.0000',
      invoiceTotal: '0.0000',
      pending: false,
    });
  });
});

describe('calculateFreight — carrier with the bid still outstanding', () => {
  it('reports pending with zeroed money when no bid has arrived', () => {
    expect(calculateFreight({ mode: 'carrier' }, config)).toEqual({
      mode: 'carrier',
      cost: '0.0000',
      margin: '0.0000',
      invoiceTotal: '0.0000',
      pending: true,
    });
  });

  it('stays pending even when the customer carries a freight margin', () => {
    expect(calculateFreight({ mode: 'carrier', freightMarginPct: '0.120000' }, config)).toEqual({
      mode: 'carrier',
      cost: '0.0000',
      margin: '0.0000',
      invoiceTotal: '0.0000',
      pending: true,
    });
  });

  it('is distinguishable from pickup, which is genuinely free', () => {
    const awaitingBid = calculateFreight({ mode: 'carrier' }, config);
    const free = calculateFreight({ mode: 'pickup' }, config);

    expect(awaitingBid.invoiceTotal).toEqual(free.invoiceTotal);
    expect(awaitingBid.pending).toBe(true);
    expect(free.pending).toBe(false);
  });

  it('resolves to a real figure once the bid is entered', () => {
    const resolved = calculateFreight(
      { mode: 'carrier', carrierBid: '250.0000', freightMarginPct: '0.120000' },
      config,
    );

    expect(resolved.pending).toBe(false);
    expect(resolved.invoiceTotal).toEqual('284.0909');
  });
});
