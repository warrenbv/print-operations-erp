// The real clock. Tests pass their own `Clock`.
import type { Clock } from '../ports';

export const systemClock: Clock = {
  now: () => new Date(),
};
