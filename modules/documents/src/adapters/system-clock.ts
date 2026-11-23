// The real clock, for the composition root.
import type { Clock } from '../ports';

export const systemClock: Clock = {
  now: () => new Date(),
};
