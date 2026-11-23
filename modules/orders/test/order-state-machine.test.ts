// The order lifecycle: the moves ORDER_TRANSITIONS allows, the ones it must not, and the guard.
import type { OrderStatus } from '@erp/types';
import { ORDER_STATUSES, ORDER_TRANSITIONS } from '@erp/types';
import { describe, expect, it } from 'vitest';

import {
  allowedTransitions,
  assertTransition,
  canTransition,
  InvalidOrderTransitionError,
  isTerminal,
} from '../src/order-state-machine';

describe('structure', () => {
  it('gives every declared status a transition list', () => {
    for (const status of ORDER_STATUSES) {
      expect(ORDER_TRANSITIONS[status]).toBeDefined();
    }
    expect(Object.keys(ORDER_TRANSITIONS).sort()).toEqual([...ORDER_STATUSES].sort());
  });

  it('only ever transitions to declared statuses', () => {
    for (const [from, targets] of Object.entries(ORDER_TRANSITIONS)) {
      for (const to of targets) {
        expect(ORDER_STATUSES, `${from} -> ${to}`).toContain(to);
      }
    }
  });

  it('never transitions a status to itself', () => {
    for (const status of ORDER_STATUSES) {
      expect(ORDER_TRANSITIONS[status], status).not.toContain(status);
    }
  });

  it('does not start at a quote-stage status', () => {
    for (const quoteStage of ['draft', 'override_requested', 'quoted', 'closed_lost']) {
      expect(ORDER_STATUSES as readonly string[]).not.toContain(quoteStage);
    }
  });
});

describe('the legal moves, per the domain model', () => {
  const legal: [OrderStatus, OrderStatus][] = [['converted', 'confirmed']];

  it.each(legal)('%s -> %s is allowed', (from, to) => {
    expect(canTransition(from, to)).toBe(true);
    expect(() => assertTransition(from, to)).not.toThrow();
  });

  it('allows exactly these and no others', () => {
    const allowed = new Set(legal.map(([f, t]) => `${f}->${t}`));
    for (const from of ORDER_STATUSES) {
      for (const to of ORDER_STATUSES) {
        const expected = allowed.has(`${from}->${to}`);
        expect(canTransition(from, to), `${from} -> ${to}`).toBe(expected);
      }
    }
  });
});

describe('the moves that must not exist', () => {
  it('cannot move backwards', () => {
    expect(canTransition('confirmed', 'converted')).toBe(false);
  });

  it('cannot leave confirmed, the last state of the order lifecycle', () => {
    expect(isTerminal('confirmed')).toBe(true);
    expect(allowedTransitions('confirmed')).toEqual([]);
  });
});

describe('assertTransition', () => {
  it('names the legal alternatives when it refuses', () => {
    try {
      assertTransition('converted', 'converted');
      throw new Error('expected a throw');
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidOrderTransitionError);
      const typed = err as InvalidOrderTransitionError;
      expect(typed.from).toBe('converted');
      expect(typed.to).toBe('converted');
      expect(typed.allowed).toEqual(['confirmed']);
      expect(typed.message).toContain('confirmed');
    }
  });

  it('says a terminal order is final rather than listing nothing', () => {
    try {
      assertTransition('confirmed', 'converted');
      throw new Error('expected a throw');
    } catch (err) {
      expect((err as Error).message).toContain('final');
    }
  });
});

describe('allowedTransitions', () => {
  it('returns a copy, so a caller cannot rewrite the rules', () => {
    const first = allowedTransitions('converted');
    first.push('converted');
    expect(allowedTransitions('converted')).toEqual(['confirmed']);
  });
});
