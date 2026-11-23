// Makes a double-submitted append form act once. Each render mints a token, and a second post with the same token
// gets the first post's outcome instead of running again, so a double click cannot create or send twice.
// apps/web/src/app/every-append-form-carries-a-token.test.ts holds every append form to this.
import { randomUUID } from 'node:crypto';

export const SUBMISSION_TOKEN_FIELD = 'submissionToken';

const TTL_MS = 60_000;

const MAX_ENTRIES = 1_000;

interface Entry {
  readonly outcome: Promise<unknown>;

  expiresAt: number;
}

// Held in this process's memory, so it deduplicates posts that reach the same web server process.
const outcomes = new Map<string, Entry>();

export function mintSubmissionToken(): string {
  return randomUUID();
}

/**
 * Runs `body` once per token and hands every later post with that token the same outcome, a thrown one
 * included, so the second press sees the first answer. A missing token runs `body` with no guard.
 */
export async function withSubmissionToken<T>(
  token: string | undefined,
  body: () => Promise<T>,
): Promise<T> {
  if (token === undefined || token === '') {
    return body();
  }

  sweep();

  const held = outcomes.get(token);
  if (held !== undefined) {
    return held.outcome as Promise<T>;
  }

  const outcome = body();
  const entry: Entry = { outcome, expiresAt: Date.now() + TTL_MS };
  outcomes.set(token, entry);
  evictOldest();

  // The window restarts when the outcome settles, so a slow first post is still guarded for the full window after it.
  void outcome
    .catch(() => undefined)
    .finally(() => {
      entry.expiresAt = Date.now() + TTL_MS;
    });

  return outcome;
}

function sweep(): void {
  const now = Date.now();
  for (const [token, entry] of outcomes) {
    if (entry.expiresAt <= now) {
      outcomes.delete(token);
    }
  }
}

function evictOldest(): void {
  while (outcomes.size > MAX_ENTRIES) {
    const oldest = outcomes.keys().next();
    if (oldest.done === true) {
      return;
    }
    outcomes.delete(oldest.value);
  }
}

export function resetSubmissionTokens(): void {
  outcomes.clear();
}
