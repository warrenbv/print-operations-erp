// The form behind the pricing constants page: each constant, how it is typed, and its change log.
// These are the configured values a line is priced from: docs/product/requirements.md (R3).
import {
  updatePricingConfigRequestSchema,
  type PricingConfig,
  type PricingConfigChange,
  type PricingConfigValues,
} from '@erp/types';

import { ratioToPercent } from '../../../lib/percent';

export type ConfigGroup = 'paper' | 'hardware' | 'margin' | 'freight';

export const CONFIG_GROUPS: readonly { readonly id: ConfigGroup; readonly label: string }[] = [
  { id: 'paper', label: 'Paper' },
  { id: 'hardware', label: 'Cores, plugs and pallets' },
  { id: 'margin', label: 'Margin and surcharge' },
  { id: 'freight', label: 'Freight' },
];

export interface ConfigField {
  readonly name: keyof PricingConfigValues & string;
  readonly label: string;
  readonly hint: string;

  readonly kind: 'decimal' | 'count' | 'percent';

  readonly maxExclusive?: string;

  readonly group: ConfigGroup;
}

export const CONFIG_FIELDS: readonly ConfigField[] = [
  {
    name: 'poundsPerTonne',
    label: 'Pounds per tonne',

    hint: 'Kept to eight decimals, because rounding it shifts every paper price.',
    kind: 'decimal',
    group: 'paper',
  },
  {
    name: 'wastePct',
    label: 'Waste %',

    hint: 'A percent, so 4 means 4 percent. Changing it reprices every later quote.',
    kind: 'percent',
    maxExclusive: '1',
    group: 'paper',
  },
  {
    name: 'coreCostPerCore',
    label: 'Core cost',
    hint: 'Landed cost of one core at the reference length below.',
    kind: 'decimal',
    group: 'hardware',
  },
  {
    name: 'coreReferenceLengthIn',
    label: 'Core reference length (in)',
    hint: 'The length the core price is quoted at. Core cost scales with roll width.',
    kind: 'decimal',
    group: 'hardware',
  },
  {
    name: 'plugCostPerPlug',
    label: 'Plug cost',

    hint: 'Kept to eight decimals. Rounding it biases every roll.',
    kind: 'decimal',
    group: 'hardware',
  },
  {
    name: 'plugsPerRoll',
    label: 'Plugs per roll',
    hint: 'Usually one at each end.',
    kind: 'count',
    group: 'hardware',
  },
  {
    name: 'palletCost',
    label: 'Pallet cost',
    hint: 'Spread across the rolls that fit on it, per product family.',
    kind: 'decimal',
    group: 'hardware',
  },
  {
    name: 'marginFloorPct',
    label: 'Margin floor %',

    hint: 'A percent, so 12 means 12 percent. Only an Admin can release a line below it.',
    kind: 'percent',
    maxExclusive: '1',
    group: 'margin',
  },
  {
    name: 'overwrapSurchargePct',
    label: 'Overwrap surcharge %',
    hint: 'A percent added to the price after the tier multiplier. Not a cost.',
    kind: 'percent',

    maxExclusive: '1000',
    group: 'margin',
  },
  {
    name: 'ourVehicleFreightRate',
    label: 'Our-vehicle freight rate',

    hint: 'Flat per order for the leg to the warehouse. Not a ZIP table.',
    kind: 'decimal',
    group: 'freight',
  },
];

export function groupedFields(): readonly {
  readonly group: (typeof CONFIG_GROUPS)[number];
  readonly fields: readonly ConfigField[];
}[] {
  return CONFIG_GROUPS.map((group) => ({
    group,
    fields: CONFIG_FIELDS.filter((field) => field.group === group.id),
  })).filter((entry) => entry.fields.length > 0);
}

export function historySum(count: number): string {
  if (count === 0) {
    return 'none yet';
  }
  return count === 1 ? '1 change' : `${count} changes`;
}

/**
 * True when the form has exactly the fields the API's update request takes. The test file asserts it,
 * so a constant added to the API cannot go without a box on this page.
 */
export function coversRequestSchema(): boolean {
  const form = CONFIG_FIELDS.map((f) => f.name).sort();
  const api = Object.keys(updatePricingConfigRequestSchema.shape).sort();
  return form.length === api.length && form.every((name, i) => name === api[i]);
}

export function prefill(config: PricingConfig, field: ConfigField): string {
  const value = config[field.name];
  if (value === null) {
    return '';
  }
  return field.kind === 'percent' ? ratioToPercent(String(value)) : String(value);
}

export function lastChangedBy(updatedBy: string | null): string {
  return updatedBy === null ? 'the initial seed' : updatedBy;
}

interface FieldMovement {
  readonly label: string;
  readonly from: string;
  readonly to: string;
}

export interface ConfigChange {
  readonly at: string;
  readonly actor: string;
  readonly movements: readonly FieldMovement[];
}

export function changeLog(
  config: PricingConfig,
  changes: readonly PricingConfigChange[],
): readonly ConfigChange[] {
  const log: ConfigChange[] = [];

  // The history arrives newest first, and each entry holds the values from before its change.
  // Walking back from the current values gives each change its before and after.
  let after: PricingConfigValues = config;

  for (const change of changes) {
    const movements: FieldMovement[] = [];
    for (const field of CONFIG_FIELDS) {
      const from = show(field, change[field.name]);
      const to = show(field, after[field.name]);
      if (from !== to) {
        movements.push({ label: field.label, from, to });
      }
    }
    log.push({ at: change.at, actor: change.actor, movements });
    after = change;
  }

  return log;
}

function show(field: ConfigField, value: PricingConfigValues[keyof PricingConfigValues]): string {
  return field.kind === 'percent' ? ratioToPercent(String(value)) : String(value);
}
