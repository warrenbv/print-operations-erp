// The production `Clock`. Tests pass their own clock to the services instead.
import type { Clock } from '../ports';

export const systemClock: Clock = {
  now: () => new Date(),
};
