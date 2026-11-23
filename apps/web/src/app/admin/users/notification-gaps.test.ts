// Tests finding and wording users whose alerts reach nobody.
import { describe, expect, it } from 'vitest';

import { gapMessage, gapSummary, hasNotificationGap, unreachableDuties } from './notification-gaps';

const pmNoEmail = { username: 'dev-pm', roles: ['ProductionManager'] as const };
const pmWithEmail = { ...pmNoEmail, email: 'fixture-34@example.test' };

describe('unreachableDuties', () => {
  it('names the duty-bearing role a user cannot be reached for', () => {
    expect(unreachableDuties(pmNoEmail)).toEqual(['ProductionManager']);
  });

  it('is empty once there is an address, whatever they hold', () => {
    expect(unreachableDuties(pmWithEmail)).toEqual([]);
  });

  it('treats an empty string as no address', () => {
    expect(unreachableDuties({ ...pmNoEmail, email: '' })).toEqual(['ProductionManager']);
  });

  it('ignores roles that carry no notification duty', () => {
    expect(unreachableDuties({ username: 'dev-sales', roles: ['Sales'] })).toEqual([]);
  });
});

describe('gapMessage', () => {
  it('says which alerts are going nowhere', () => {
    expect(gapMessage(pmNoEmail)).toBe(
      'No email address on record, so this user receives no ProductionManager alerts.',
    );
  });

  it('is absent for a reachable user, so the row carries nothing', () => {
    expect(gapMessage(pmWithEmail)).toBeUndefined();
  });
});

describe('gapSummary', () => {
  it('is absent when every duty-holder is reachable', () => {
    expect(gapSummary([pmWithEmail, { username: 'dev-sales', roles: ['Sales'] }])).toBeUndefined();
  });

  it('names the one affected user by username', () => {
    expect(gapSummary([pmWithEmail, pmNoEmail])).toContain('dev-pm holds');
  });

  it('counts them once there is more than one', () => {
    const summary = gapSummary([pmNoEmail, { username: 'dev-pm-2', roles: ['ProductionManager'] }]);
    expect(summary).toContain('2 users hold');
  });

  it('says the rows below carry the detail', () => {
    expect(gapSummary([pmNoEmail])).toContain('Marked below.');
  });
});

describe('hasNotificationGap', () => {
  it('is the predicate the row renders on', () => {
    expect(hasNotificationGap(pmNoEmail)).toBe(true);
    expect(hasNotificationGap(pmWithEmail)).toBe(false);
  });
});
