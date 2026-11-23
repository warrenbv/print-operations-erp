// The form behind the pricing tiers page, and the tiers' change log.
// A tier sets a line's margin by pallet count: docs/product/requirements.md (R3).
import {
  toDecimal,
  updatePricingTierRequestSchema,
  type PricingTier,
  type PricingTierChange,
  type PricingTierValues,
} from '@erp/types';

import { ratioToPercent } from '../../../lib/percent';

export interface TierField {
  readonly name: keyof PricingTierValues & string;
  readonly label: string;
  readonly hint: string;

  readonly kind: 'decimal' | 'count' | 'text' | 'percent';

  readonly maxExclusive?: string;
}

export const TIER_FIELDS: readonly TierField[] = [
  {
    name: 'name',
    label: 'Name',
    hint: 'Shown here and in the tier picker on a quote line.',
    kind: 'text',
  },
  {
    name: 'marginPct',
    label: 'Margin %',

    hint: 'A percent, so 22 means 22 percent. It must be under 100.',
    kind: 'percent',
    maxExclusive: '1',
  },
  {
    name: 'minPallets',
    label: 'From pallets',

    hint: 'The tier applies from this pallet count up to the next tier.',
    kind: 'count',
  },
];

/**
 * True when the form has exactly the fields the API's update request takes. The test file asserts it,
 * so a tier field added to the API cannot go without a box on this page.
 */
export function coversRequestSchema(): boolean {
  const form = TIER_FIELDS.map((f) => f.name).sort();
  const api = Object.keys(updatePricingTierRequestSchema.shape).sort();
  return form.length === api.length && form.every((name, i) => name === api[i]);
}

export function valueOf(tier: PricingTier, name: keyof PricingTierValues): string {
  const field = TIER_FIELDS.find((f) => f.name === name);
  const value = String(tier[name]);
  return field?.kind === 'percent' ? ratioToPercent(value) : value;
}

/**
 * The cost multiplier 1 / (1 - margin), to four places, for display. A margin of 1 or more shows a
 * dash instead of dividing by zero. Prices are computed by the API, never here.
 */
export function multiplierOf(marginPct: string): string {
  const divisor = toDecimal('1').minus(toDecimal(marginPct));
  if (divisor.lte(toDecimal('0'))) {
    return '—';
  }
  return toDecimal('1').div(divisor).toFixed(4);
}

export function asPercent(marginPct: string): string {
  return `${toDecimal(marginPct).times('100').toFixed(1)}%`;
}

function showValue(field: TierField, value: PricingTierValues[keyof PricingTierValues]): string {
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

export interface TierChange {
  readonly at: string;
  readonly actor: string;
  readonly tierCode: string;

  readonly tierName: string;
  readonly movements: readonly FieldMovement[];
}

export function tierChangeLog(
  tiers: readonly PricingTier[],
  changes: readonly PricingTierChange[],
): readonly TierChange[] {
  const after = new Map<string, PricingTierValues>();
  const liveNames = new Map<string, string>();
  for (const tier of tiers) {
    after.set(tier.code, tier);
    liveNames.set(tier.code, tier.name);
  }

  // The history arrives newest first, and each entry holds the tier's values from before its change.
  // Walking back from the current tiers gives each change its before and after.
  const log: TierChange[] = [];
  for (const change of changes) {
    const next = after.get(change.tierCode);
    const movements: FieldMovement[] = [];
    if (next !== undefined) {
      for (const field of TIER_FIELDS) {
        const from = showValue(field, change[field.name]);
        const to = showValue(field, next[field.name]);
        if (from !== to) {
          movements.push({ label: field.label, from, to });
        }
      }
    }
    log.push({
      at: change.at,
      actor: change.actor,
      tierCode: change.tierCode,

      tierName: liveNames.get(change.tierCode) ?? change.name,
      movements,
    });
    after.set(change.tierCode, change);
  }

  return log;
}
