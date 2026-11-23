// Tests modules/identity/src/adapters/argon2-password-hasher.ts with the real library.
import { describe, expect, it } from 'vitest';

import { Argon2PasswordHasher } from '../src/adapters/argon2-password-hasher';

const hasher = new Argon2PasswordHasher();

describe('Argon2PasswordHasher', () => {
  it('produces an argon2id hash that verifies', async () => {
    const hash = await hasher.hash('sealed-emergency-password');
    expect(hash.startsWith('$argon2id$')).toBe(true);
    expect(await hasher.verify(hash, 'sealed-emergency-password')).toBe(true);
  });

  it('rejects a wrong password', async () => {
    const hash = await hasher.hash('sealed-emergency-password');
    expect(await hasher.verify(hash, 'sealed-emergency-passwore')).toBe(false);
  });

  it('salts — the same password hashes differently every time', async () => {
    const [a, b] = await Promise.all([hasher.hash('same'), hasher.hash('same')]);
    expect(a).not.toBe(b);
  });

  it('treats a malformed stored hash as a wrong password, not an exception', async () => {
    await expect(hasher.verify('not-a-hash', 'anything')).resolves.toBe(false);
  });
});
