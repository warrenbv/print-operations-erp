// The `SessionStore` in PostgreSQL. Rows hold the token hash, never the token:
// docs/decisions/005-server-side-sessions.md. Sessions survive an API restart in this mode.
import { newId } from '@erp/db';
import { eq } from 'drizzle-orm';

import type { IdentityDb } from '../../data/identity-db';
import { sessions } from '../../data/schema';
import type { SessionRecord, SessionStore } from '../../ports';

export class DrizzleSessionStore implements SessionStore {
  readonly #db: IdentityDb;

  constructor(db: IdentityDb) {
    this.#db = db;
  }

  async create(session: Omit<SessionRecord, 'id'>): Promise<SessionRecord> {
    const [row] = await this.#db
      .insert(sessions)
      .values({ id: newId(), ...session })
      .returning();

    if (row === undefined) {
      throw new Error('Creating a session returned no row');
    }
    return row;
  }

  async findByTokenHash(tokenHash: string): Promise<SessionRecord | null> {
    const [row] = await this.#db
      .select()
      .from(sessions)
      .where(eq(sessions.tokenHash, tokenHash))
      .limit(1);
    return row ?? null;
  }

  async touch(id: string, lastSeenAt: Date): Promise<void> {
    await this.#db.update(sessions).set({ lastSeenAt }).where(eq(sessions.id, id));
  }

  async delete(id: string): Promise<void> {
    await this.#db.delete(sessions).where(eq(sessions.id, id));
  }
}
