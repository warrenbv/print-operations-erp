// Tests the quote transition table and its helpers, including that every non-final state can still
// reach a final one. Subject: modules/quoting/src/quote-state-machine.ts.
import type { QuoteStatus } from '@erp/types';
import {
  CONVERTIBLE_QUOTE_STATUSES,
  EDITABLE_QUOTE_STATUSES,
  INITIAL_QUOTE_STATUS,
  QUOTE_STATUSES,
  QUOTE_TRANSITIONS,
  TERMINAL_QUOTE_STATUSES,
} from '@erp/types';
import { describe, expect, it } from 'vitest';

import {
  InvalidQuoteTransitionError,
  allowedTransitions,
  assertTransition,
  canTransition,
  deadEndStatuses,
  isConvertible,
  isEditable,
  isTerminal,
  reachableStatuses,
} from '../src/quote-state-machine';

describe('the transition table', () => {
  it('names every status, so no state is a compile-time hole', () => {
    expect(Object.keys(QUOTE_TRANSITIONS).sort()).toEqual([...QUOTE_STATUSES].sort());
  });

  it('never points at a status that does not exist', () => {
    for (const [from, targets] of Object.entries(QUOTE_TRANSITIONS)) {
      for (const to of targets) {
        expect(QUOTE_STATUSES, `${from} -> ${to}`).toContain(to);
      }
    }
  });

  it('has no self-edges — a move to where you already are is not a move', () => {
    for (const status of QUOTE_STATUSES) {
      expect(QUOTE_TRANSITIONS[status], status).not.toContain(status);
    }
  });

  it('lists no target twice', () => {
    for (const status of QUOTE_STATUSES) {
      const targets = QUOTE_TRANSITIONS[status];
      expect(new Set(targets).size, status).toBe(targets.length);
    }
  });

  it('starts at draft (the order owns everything from conversion on)', () => {
    expect(INITIAL_QUOTE_STATUS).toBe('draft');
    expect(QUOTE_STATUSES).toContain(INITIAL_QUOTE_STATUS);
  });

  it('holds the four statuses plus `superseded`, and no `converted`', () => {
    expect([...QUOTE_STATUSES]).toEqual([
      'draft',
      'override_requested',
      'quoted',
      'superseded',
      'closed_lost',
    ]);
  });
});

describe('reachability', () => {
  it('reaches every status from draft — no state is dead on arrival', () => {
    const reachable = reachableStatuses();
    for (const status of QUOTE_STATUSES) {
      expect(reachable.has(status), `${status} is unreachable from draft`).toBe(true);
    }
  });

  it('has no dead ends — every live state can still be closed', () => {
    expect(deadEndStatuses()).toEqual([]);
  });

  it('has two terminal states that mean different things', () => {
    expect([...TERMINAL_QUOTE_STATUSES]).toEqual(['superseded', 'closed_lost']);
  });

  it('lets a won quote sit at quoted rather than forcing it anywhere', () => {
    expect(isTerminal('quoted')).toBe(false);
    expect(canTransition('quoted', 'closed_lost')).toBe(true);
  });

  it('does not send a sent quote back to draft', () => {
    expect(canTransition('quoted', 'draft')).toBe(false);
    expect(canTransition('quoted', 'superseded')).toBe(true);
  });
});

describe('canTransition', () => {
  it('allows the moves the lifecycle draws', () => {
    expect(canTransition('draft', 'quoted')).toBe(true);
    expect(canTransition('draft', 'override_requested')).toBe(true);
    expect(canTransition('draft', 'closed_lost')).toBe(true);
    expect(canTransition('override_requested', 'quoted')).toBe(true);
    expect(canTransition('override_requested', 'draft')).toBe(true);
    expect(canTransition('quoted', 'superseded')).toBe(true);
  });

  it('refuses to move anything out of closed_lost', () => {
    for (const status of QUOTE_STATUSES) {
      expect(canTransition('closed_lost', status), status).toBe(false);
    }
  });

  it('never supersedes anything that was not sent', () => {
    for (const status of QUOTE_STATUSES) {
      if (status === 'quoted') continue;
      expect(canTransition(status, 'superseded'), `${status} -> superseded`).toBe(false);
    }
  });

  it('refuses to skip straight from draft to nothing else', () => {
    const legal = new Set<QuoteStatus>(['quoted', 'override_requested', 'closed_lost']);
    for (const status of QUOTE_STATUSES) {
      expect(canTransition('draft', status), `draft -> ${status}`).toBe(legal.has(status));
    }
  });
});

describe('allowedTransitions', () => {
  it('is what a UI should offer', () => {
    expect(allowedTransitions('quoted').sort()).toEqual(['closed_lost', 'superseded']);
  });

  it('is empty for a terminal state', () => {
    expect(allowedTransitions('closed_lost')).toEqual([]);
  });

  it('returns a copy — a caller cannot edit the rules for everyone else', () => {
    const first = allowedTransitions('draft');
    first.push('closed_lost');
    expect(allowedTransitions('draft')).not.toEqual(first);
  });
});

describe('assertTransition', () => {
  it('passes a legal move silently', () => {
    expect(() => assertTransition('draft', 'quoted')).not.toThrow();
  });

  it('throws with the legal alternatives, not just a refusal', () => {
    try {
      assertTransition('draft', 'draft');
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidQuoteTransitionError);
      const typed = err as InvalidQuoteTransitionError;
      expect(typed.from).toBe('draft');
      expect(typed.to).toBe('draft');
      expect(typed.allowed).toEqual(QUOTE_TRANSITIONS.draft);
      expect(typed.message).toContain('allowed:');
    }
  });

  it('says a terminal state is final rather than listing nothing', () => {
    try {
      assertTransition('closed_lost', 'draft');
      expect.unreachable('should have thrown');
    } catch (err) {
      expect((err as Error).message).toContain('is final');
    }
  });
});

describe('isEditable', () => {
  it('allows line writes only while a quote is being worked on', () => {
    expect(isEditable('draft')).toBe(true);
    expect(isEditable('override_requested')).toBe(true);
  });

  it('seals a quote once it has been sent, replaced or lost', () => {
    expect(isEditable('quoted')).toBe(false);
    expect(isEditable('superseded')).toBe(false);
    expect(isEditable('closed_lost')).toBe(false);
  });

  it('agrees with the exported set', () => {
    for (const status of QUOTE_STATUSES) {
      expect(isEditable(status), status).toBe(EDITABLE_QUOTE_STATUSES.includes(status));
    }
  });

  it('leaves a sent quote no way back to editing — revision is a new version', () => {
    const reachable = [...reachableStatuses('quoted')];
    expect(reachable.some(isEditable)).toBe(false);
  });
});

describe('isConvertible', () => {
  it('converts only a quote the customer has actually received', () => {
    expect(isConvertible('quoted')).toBe(true);
    expect(isConvertible('draft')).toBe(false);
    expect(isConvertible('override_requested')).toBe(false);
    expect(isConvertible('closed_lost')).toBe(false);
  });

  it('never converts a superseded version', () => {
    expect(isConvertible('superseded')).toBe(false);
  });

  it('agrees with the exported set', () => {
    for (const status of QUOTE_STATUSES) {
      expect(isConvertible(status), status).toBe(CONVERTIBLE_QUOTE_STATUSES.includes(status));
    }
  });

  it('never calls a sealed-for-editing state anything but convertible-or-lost', () => {
    for (const status of QUOTE_STATUSES) {
      if (isConvertible(status)) {
        expect(isEditable(status), status).toBe(false);
      }
    }
  });
});
