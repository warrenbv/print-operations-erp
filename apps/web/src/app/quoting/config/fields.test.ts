// Tests the pricing constants form: that it covers the API's request schema, its prefill and its change log.
import {
  updatePricingConfigRequestSchema,
  type PricingConfig,
  type PricingConfigChange,
} from '@erp/types';
import { describe, expect, it } from 'vitest';

import {
  CONFIG_FIELDS,
  CONFIG_GROUPS,
  changeLog,
  coversRequestSchema,
  groupedFields,
  historySum,
  lastChangedBy,
  prefill,
} from './fields';

const CONFIG: PricingConfig = {
  poundsPerTonne: '2204.62262185',
  wastePct: '0.090000',
  coreCostPerCore: '2.0000',
  coreReferenceLengthIn: '48.0000',
  plugCostPerPlug: '0.05000000',
  plugsPerRoll: 2,
  palletCost: '10.0000',
  marginFloorPct: '0.170000',
  overwrapSurchargePct: '0.040000',
  ourVehicleFreightRate: '30.0000',
  updatedAt: '2026-08-24T18:00:00.000Z',
  updatedBy: 'dev-billing',
};

describe('CONFIG_FIELDS', () => {
  it('covers exactly what the API accepts', () => {
    expect(coversRequestSchema()).toBe(true);
  });

  it('names the same keys the schema does', () => {
    expect(CONFIG_FIELDS.map((f) => f.name).sort()).toEqual(
      Object.keys(updatePricingConfigRequestSchema.shape).sort(),
    );
  });

  it('includes the margin floor, which is the point of the page', () => {
    const floor = CONFIG_FIELDS.find((f) => f.name === 'marginFloorPct');
    expect(floor).toBeDefined();

    expect(floor?.hint).toContain('Only an Admin can release a line below it.');
  });

  it('treats plug count as a count and everything else as a decimal', () => {
    const counts = CONFIG_FIELDS.filter((f) => f.kind === 'count').map((f) => f.name);
    expect(counts).toEqual(['plugsPerRoll']);
  });

  it('puts every constant in one of the four groups the page draws', () => {
    const ids = CONFIG_GROUPS.map((g) => g.id);
    for (const field of CONFIG_FIELDS) {
      expect(ids).toContain(field.group);
    }
  });

  it('names the four groups in the order the page draws them', () => {
    expect(CONFIG_GROUPS.map((g) => g.label)).toEqual([
      'Paper',
      'Cores, plugs and pallets',
      'Margin and surcharge',
      'Freight',
    ]);
  });

  it('loses and reorders no constant when it groups them', () => {
    expect(groupedFields().flatMap((entry) => entry.fields)).toEqual(CONFIG_FIELDS);
  });

  it('files the margin floor under margin and surcharge', () => {
    expect(CONFIG_FIELDS.find((f) => f.name === 'marginFloorPct')?.group).toBe('margin');
  });
});

describe('prefill', () => {
  it('renders a stored decimal unchanged, at full precision', () => {
    const field = CONFIG_FIELDS.find((f) => f.name === 'plugCostPerPlug');
    expect(field && prefill(CONFIG, field)).toBe('0.05000000');
  });

  it('renders a count as its digits', () => {
    const field = CONFIG_FIELDS.find((f) => f.name === 'plugsPerRoll');
    expect(field && prefill(CONFIG, field)).toBe('2');
  });

  it('renders a percent field as the percent its label asks for', () => {
    const floor = CONFIG_FIELDS.find((f) => f.name === 'marginFloorPct');
    expect(floor && prefill(CONFIG, floor)).toBe('17');
    const waste = CONFIG_FIELDS.find((f) => f.name === 'wastePct');
    expect(waste && prefill(CONFIG, waste)).toBe('9');
  });

  it('is lossless, so saving an untouched form writes back what was stored', () => {
    const field = CONFIG_FIELDS.find((f) => f.name === 'marginFloorPct');
    expect(field && prefill({ ...CONFIG, marginFloorPct: '0.163250' }, field)).toBe('16.325');
  });

  it('bounds each percent field by what its own column will hold', () => {
    const by = (name: string) => CONFIG_FIELDS.find((f) => f.name === name);
    expect(by('wastePct')?.maxExclusive).toBe('1');
    expect(by('marginFloorPct')?.maxExclusive).toBe('1');
    expect(by('overwrapSurchargePct')?.maxExclusive).toBe('1000');
  });
});

describe('lastChangedBy', () => {
  it('names the person who changed it', () => {
    expect(lastChangedBy('dev-billing')).toBe('dev-billing');
  });

  it('says where seeded values came from rather than "unknown"', () => {
    expect(lastChangedBy(null)).toBe('the initial seed');
  });

  it('lets a system actor read as itself', () => {
    expect(lastChangedBy('system:edit')).toBe('system:edit');
  });
});

function change(at: string, actor: string, previous: Partial<PricingConfigChange>) {
  const values: Record<string, unknown> = { ...CONFIG };
  delete values['updatedAt'];
  delete values['updatedBy'];
  return { ...values, at, actor, ...previous } as PricingConfigChange;
}

describe('changeLog', () => {
  it('is empty when nothing has changed', () => {
    expect(changeLog(CONFIG, [])).toEqual([]);
  });

  it('sums the closed history fold by how many changes it holds', () => {
    expect(historySum(0)).toBe('none yet');
    expect(historySum(1)).toBe('1 change');
    expect(historySum(4)).toBe('4 changes');
  });

  it('pairs the newest row against the live config', () => {
    const log = changeLog(CONFIG, [
      change('2026-08-24T17:00:00.000Z', 'dev-billing', { marginFloorPct: '0.110000' }),
    ]);

    expect(log).toHaveLength(1);
    expect(log[0]?.actor).toBe('dev-billing');
    expect(log[0]?.movements).toEqual([{ label: 'Margin floor %', from: '11', to: '17' }]);
  });

  it('reports only the constants that moved', () => {
    const log = changeLog(CONFIG, [
      change('2026-08-24T17:00:00.000Z', 'dev-billing', { wastePct: '0.140000' }),
    ]);

    expect(log[0]?.movements).toEqual([{ label: 'Waste %', from: '14', to: '9' }]);
  });

  it('reports several movements from one change', () => {
    const log = changeLog(CONFIG, [
      change('2026-08-24T17:00:00.000Z', 'dev-billing', {
        wastePct: '0.140000',
        palletCost: '11.2500',
      }),
    ]);

    expect(log[0]?.movements.map((m) => m.label)).toEqual(['Waste %', 'Pallet cost']);
  });

  it('chains each change to the one after it, not to the live config', () => {
    const log = changeLog(CONFIG, [
      change('2026-08-24T17:00:00.000Z', 'second', { wastePct: '0.040000' }),
      change('2026-08-24T16:00:00.000Z', 'first', { wastePct: '0.140000' }),
    ]);

    expect(log[0]?.movements).toEqual([{ label: 'Waste %', from: '4', to: '9' }]);
    expect(log[1]?.movements).toEqual([{ label: 'Waste %', from: '14', to: '4' }]);
  });

  it('compares a count without tripping over its type', () => {
    const log = changeLog(CONFIG, [
      change('2026-08-24T17:00:00.000Z', 'dev-billing', { plugsPerRoll: 4 }),
    ]);

    expect(log[0]?.movements).toEqual([{ label: 'Plugs per roll', from: '4', to: '2' }]);
  });

  it('yields no movements for a change that moved nothing', () => {
    const log = changeLog(CONFIG, [change('2026-08-24T17:00:00.000Z', 'dev-billing', {})]);

    expect(log[0]?.movements).toEqual([]);
  });
});
