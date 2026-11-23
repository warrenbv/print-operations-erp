// The `SessionStore` in memory. Every session ends when the process stops.
import { randomUUID } from 'node:crypto';

import type { SessionRecord, SessionStore } from '../../ports';

export class InMemorySessionStore implements SessionStore {
  readonly #byId = new Map<string, SessionRecord>();
  readonly #idByTokenHash = new Map<string, string>();

  async create(session: Omit<SessionRecord, 'id'>): Promise<SessionRecord> {
    const record: SessionRecord = { id: randomUUID(), ...session };
    this.#byId.set(record.id, record);
    this.#idByTokenHash.set(record.tokenHash, record.id);
    return record;
  }

  async findByTokenHash(tokenHash: string): Promise<SessionRecord | null> {
    const id = this.#idByTokenHash.get(tokenHash);
    return id === undefined ? null : (this.#byId.get(id) ?? null);
  }

  async touch(id: string, lastSeenAt: Date): Promise<void> {
    const record = this.#byId.get(id);
    if (record !== undefined) {
      this.#byId.set(id, { ...record, lastSeenAt });
    }
  }

  async delete(id: string): Promise<void> {
    const record = this.#byId.get(id);
    if (record !== undefined) {
      this.#idByTokenHash.delete(record.tokenHash);
      this.#byId.delete(id);
    }
  }
}
