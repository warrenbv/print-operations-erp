// `break-glass:set`: sets or rotates the break-glass password in PostgreSQL at a hidden prompt.
// It refuses to run without an interactive terminal, so the password never sits in an argument or the
// environment. In memory mode the API takes a password from `BREAK_GLASS_DEV_PASSWORD` instead, in
// apps/api/src/auth/auth.factory.ts.
import { createPool } from '@erp/db';

import { Argon2PasswordHasher } from '../adapters/argon2-password-hasher';
import { DrizzleBreakGlassStore } from '../adapters/drizzle/drizzle-break-glass-store';
import { createIdentityDb } from '../data/identity-db';

import { promptHidden } from './prompt-hidden';

const MINIMUM_LENGTH = 16;

async function main(): Promise<void> {
  if (!process.stdin.isTTY) {
    throw new Error(
      'break-glass:set needs an interactive terminal: the password is typed at a ' +
        'prompt, never passed as an argument or environment variable. Run it in an ' +
        'interactive session on the server.',
    );
  }

  const pool = createPool();
  try {
    const store = new DrizzleBreakGlassStore(createIdentityDb(pool));
    const existing = await store.load();
    if (existing !== null) {
      console.warn('A break-glass credential already exists. Continuing replaces it.');
    }

    const password = await promptHidden('New break-glass password: ');
    if (password.length < MINIMUM_LENGTH) {
      throw new Error(
        `Password must be at least ${MINIMUM_LENGTH} characters (got ${password.length}) — nothing was written.`,
      );
    }

    const confirmation = await promptHidden('Confirm password: ');
    if (password !== confirmation) {
      throw new Error('The two entries did not match — nothing was written.');
    }

    // Setting a password also clears any failure count and lock.
    await store.setPassword(await new Argon2PasswordHasher().hash(password));

    console.info(
      existing === null
        ? 'Break-glass credential provisioned.'
        : 'Break-glass credential rotated. The previous password no longer works.',
    );
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
