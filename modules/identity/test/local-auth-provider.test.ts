// Tests modules/identity/src/providers/local-auth-provider.ts and the addresses it gives its accounts.
import { describe, expect, it } from 'vitest';

import { InMemoryUserRepository } from '../src/adapters/in-memory/in-memory-user-repository';
import {
  DEV_EMAIL_DOMAIN,
  DEV_USERNAMES,
  LocalAuthProvider,
  devEmailFor,
} from '../src/providers/local-auth-provider';

const PASSWORD = 'dev-password';

describe('devEmailFor', () => {
  it('is deterministic, so a log line can be grepped back to a user', () => {
    expect(devEmailFor('dev-sales')).toBe(`dev-sales@${DEV_EMAIL_DOMAIN}`);
    expect(devEmailFor('dev-sales')).toBe(devEmailFor('dev-sales'));
  });

  it('normalizes the username the same way the provider does', () => {
    expect(devEmailFor('DEV-Sales')).toBe(`dev-sales@${DEV_EMAIL_DOMAIN}`);
  });

  it('sits on a domain that can never accept mail', () => {
    expect(DEV_EMAIL_DOMAIN).toBe('example.test');
  });
});

describe('LocalAuthProvider', () => {
  it('gives every dev user an address', async () => {
    const provider = new LocalAuthProvider(PASSWORD);

    for (const username of DEV_USERNAMES) {
      const result = await provider.authenticate(username, PASSWORD);
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      expect(result.identity.email).toBe(devEmailFor(username));
    }
  });

  it('still refuses a wrong password and an unknown user', async () => {
    const provider = new LocalAuthProvider(PASSWORD);

    expect(await provider.authenticate('dev-sales', 'wrong')).toMatchObject({ ok: false });
    expect(await provider.authenticate('nobody', PASSWORD)).toMatchObject({ ok: false });
  });

  it('provisions the address onto the user record on first login', async () => {
    const provider = new LocalAuthProvider(PASSWORD);
    const users = new InMemoryUserRepository();

    const result = await provider.authenticate('dev-billing', PASSWORD);
    if (!result.ok) throw new Error('expected a successful login');
    const user = await users.upsertFromIdentity(result.identity);

    expect(user.email).toBe(`dev-billing@${DEV_EMAIL_DOMAIN}`);
  });

  it('refreshes the address on a later login, which is what fixtures must grant after', async () => {
    const provider = new LocalAuthProvider(PASSWORD);
    const users = new InMemoryUserRepository();

    const first = await provider.authenticate('dev-pm-test', PASSWORD);
    expect(first.ok).toBe(false);

    const result = await provider.authenticate('dev-production-manager', PASSWORD);
    if (!result.ok) throw new Error('expected a successful login');
    const provisioned = await users.upsertFromIdentity(result.identity);
    expect(provisioned.email).toBeDefined();

    const cleared = await users.upsertFromIdentity({
      externalId: provisioned.externalId,
      username: provisioned.username,
      displayName: provisioned.displayName,
    });
    expect(cleared.email).toBeUndefined();

    const relogin = await provider.authenticate('dev-production-manager', PASSWORD);
    if (!relogin.ok) throw new Error('expected a successful login');
    expect((await users.upsertFromIdentity(relogin.identity)).email).toBeDefined();
  });
});
