// The `PasswordHasher` for the break-glass credential, with the library's default argon2 settings.
import { hash, verify } from '@node-rs/argon2';

import type { PasswordHasher } from '../ports';

export class Argon2PasswordHasher implements PasswordHasher {
  async hash(plaintext: string): Promise<string> {
    return hash(plaintext);
  }

  async verify(hashed: string, plaintext: string): Promise<boolean> {
    try {
      return await verify(hashed, plaintext);
    } catch {
      // A stored hash the library cannot read counts as a mismatch, so sign-in fails closed.
      return false;
    }
  }
}
