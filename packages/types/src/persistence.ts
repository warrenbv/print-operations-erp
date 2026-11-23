// The storage modes a process can run in. The guard that chooses one and refuses memory mode in production is
// apps/api/src/config/persistence-guard.ts: docs/decisions/007-persistence-switch-at-the-composition-root.md.
export const PERSISTENCE_MODES = ['postgres', 'memory'] as const;

export type PersistenceMode = (typeof PERSISTENCE_MODES)[number];
