// The delivery-method labels the documents print in place of internal shipping modes, from
// packages/types. Pickup labels name the collection site, and delivery labels reveal no routing or cost.
import {
  DELIVERY_METHOD_LABELS,
  PLANT_SITE,
  SHIPPING_MODES,
  WAREHOUSE_SITE,
  deliveryMethodLabel,
  type ShippingMode,
} from '@erp/types';
import { describe, expect, it } from 'vitest';

const PICKUP_MODES: readonly ShippingMode[] = ['pickup', 'our_vehicle'];

describe('delivery method labels', () => {
  it('covers every shipping mode', () => {
    for (const mode of SHIPPING_MODES) {
      expect(deliveryMethodLabel(mode)).toBeTruthy();
    }
  });

  it('gives every mode a distinct label except where the modes are the same event', () => {
    const distinct = new Set(Object.values(DELIVERY_METHOD_LABELS));
    expect(distinct.size).toBe(4);
  });

  it('tells a pickup customer which site to collect from', () => {
    expect(deliveryMethodLabel('pickup')).toContain('Demo Printworks');
    expect(deliveryMethodLabel('our_vehicle')).toContain('Demo Printworks warehouse');

    for (const mode of PICKUP_MODES) {
      expect(deliveryMethodLabel(mode).toLowerCase()).toContain('pickup');
    }
  });

  it('never says "delivered" to a customer who has to come and get it', () => {
    for (const mode of PICKUP_MODES) {
      expect(deliveryMethodLabel(mode).toLowerCase()).not.toContain('delivered');
    }
  });

  it('never names our routing or cost structure on a DELIVERY label', () => {
    const forbidden = [
      PLANT_SITE.address.city.toLowerCase(),
      WAREHOUSE_SITE.address.city.toLowerCase(),
      'our vehicle',
      'pass-through',
      'pass_through',
      'leg',
      'flat',
      'margin',
      'cost',
      'warehouse',
      'plant',
    ];
    const deliveryModes = SHIPPING_MODES.filter((mode) => !PICKUP_MODES.includes(mode));
    expect(deliveryModes.length).toBe(2);

    for (const mode of deliveryModes) {
      for (const word of forbidden) {
        expect(deliveryMethodLabel(mode).toLowerCase()).not.toContain(word);
      }
    }
  });

  it('never names a cost structure on ANY label', () => {
    for (const label of Object.values(DELIVERY_METHOD_LABELS)) {
      for (const word of ['flat', 'margin', 'cost', 'bid', 'rate']) {
        expect(label.toLowerCase()).not.toContain(word);
      }
    }
  });

  it('does not leak a snake_case mode identifier', () => {
    const identifiers = SHIPPING_MODES.filter((mode) => mode.includes('_'));
    expect(identifiers.length).toBeGreaterThan(0);

    for (const mode of identifiers) {
      for (const label of Object.values(DELIVERY_METHOD_LABELS)) {
        expect(label).not.toContain(mode);
      }
    }
  });
});
