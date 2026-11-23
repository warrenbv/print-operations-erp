// The wall clock behind the `Clock` port. Tests construct services with a fixed clock instead.
import type { Clock } from '../ports';

export const systemClock: Clock = {
  now: () => new Date(),
};
