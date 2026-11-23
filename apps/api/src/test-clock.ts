// The one clock the composition root hands every module and route.
// Reading real time anywhere else in apps/api/src needs an entry in apps/api/test/one-clock-at-the-root.test.ts.
export interface ApiClock {
  now(): Date;
}

export const systemClock: ApiClock = { now: () => new Date() };

export const apiClock: ApiClock = systemClock;
