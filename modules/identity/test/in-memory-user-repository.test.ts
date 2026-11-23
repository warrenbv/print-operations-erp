// Tests modules/identity/src/adapters/in-memory/in-memory-user-repository.ts, including which row answers
// when two share a username.
import { describe, expect, it } from 'vitest';

import { InMemoryUserRepository } from '../src/adapters/in-memory/in-memory-user-repository';

describe('InMemoryUserRepository.findByExternalId', () => {
  it('returns null for an unknown externalId', async () => {
    const repo = new InMemoryUserRepository();
    expect(await repo.findByExternalId('nobody')).toBeNull();
  });

  it('returns the user after upsert', async () => {
    const repo = new InMemoryUserRepository();
    const created = await repo.upsertFromIdentity({
      externalId: 'ad-guid-1',
      username: 'jsmith',
      displayName: 'Taylor Example',
    });
    const found = await repo.findByExternalId('ad-guid-1');
    expect(found?.id).toBe(created.id);
    expect(found?.username).toBe('jsmith');
  });
});

describe('InMemoryUserRepository.findByUsername', () => {
  it('returns null for a username nobody holds', async () => {
    const repo = new InMemoryUserRepository();
    expect(await repo.findByUsername('nobody')).toBeNull();
  });

  it('returns the user, carrying the address a failure notice needs', async () => {
    const repo = new InMemoryUserRepository();
    const created = await repo.upsertFromIdentity({
      externalId: 'ad-guid-1',
      username: 'jsmith',
      displayName: 'Taylor Example',
      email: 'jsmith@example.test',
    });

    const found = await repo.findByUsername('jsmith');

    expect(found?.id).toBe(created.id);
    expect(found?.email).toBe('jsmith@example.test');
  });

  it('answers with the account holding the name now when two rows carry it', async () => {
    const repo = new InMemoryUserRepository();
    const departed = await repo.upsertFromIdentity({
      externalId: 'ad-guid-departed',
      username: 'jsmith',
      displayName: 'Taylor Example',
      email: 'john.smith@example.test',
    });
    const newHire = await repo.upsertFromIdentity({
      externalId: 'ad-guid-new-hire',
      username: 'jsmith',
      displayName: 'Jordan Example',
      email: 'jane.smith@example.test',
    });

    expect((await repo.findByUsername('jsmith'))?.id).toBe(newHire.id);

    await repo.setRoles(departed.id, ['Sales']);

    expect((await repo.findByUsername('jsmith'))?.id).toBe(departed.id);
  });
});

describe('InMemoryUserRepository.findByUsernames', () => {
  async function withUsers() {
    const repo = new InMemoryUserRepository();
    await repo.upsertFromIdentity({
      externalId: 'ad-guid-z',
      username: 'zoe',
      displayName: 'Zoe Demo',
      email: 'zoe@example.test',
    });
    await repo.upsertFromIdentity({
      externalId: 'ad-guid-a',
      username: 'adam',
      displayName: 'Adam Example',
    });
    return repo;
  }

  it('answers nothing for an empty question', async () => {
    expect(await (await withUsers()).findByUsernames([])).toEqual([]);
  });

  it('resolves several names at once, ordered by username', async () => {
    const repo = await withUsers();

    const found = await repo.findByUsernames(['zoe', 'adam']);

    expect(found.map((u) => u.username)).toEqual(['adam', 'zoe']);
    expect(found.map((u) => u.displayName)).toEqual(['Adam Example', 'Zoe Demo']);
  });

  it('collapses duplicates and leaves out a name nobody holds', async () => {
    const repo = await withUsers();

    const found = await repo.findByUsernames(['adam', 'adam', 'nobody']);

    expect(found.map((u) => u.username)).toEqual(['adam']);
  });

  it('picks the account holding each name now, as the single lookup does', async () => {
    const repo = new InMemoryUserRepository();
    await repo.upsertFromIdentity({
      externalId: 'ad-guid-departed',
      username: 'jsmith',
      displayName: 'Taylor Example',
    });
    const newHire = await repo.upsertFromIdentity({
      externalId: 'ad-guid-new-hire',
      username: 'jsmith',
      displayName: 'Jordan Example',
    });

    const found = await repo.findByUsernames(['jsmith']);

    expect(found).toHaveLength(1);
    expect(found[0]?.id).toBe(newHire.id);
    expect(found[0]?.displayName).toBe('Jordan Example');
  });
});

describe('InMemoryUserRepository.setRoles', () => {
  it('returns null for an unknown id (service can 404 without exceptions as control flow)', async () => {
    const repo = new InMemoryUserRepository();
    expect(await repo.setRoles('does-not-exist', ['Sales'])).toBeNull();
  });

  it('replaces the role set entirely (last-write-wins)', async () => {
    const repo = new InMemoryUserRepository();
    const created = await repo.upsertFromIdentity({
      externalId: 'ad-guid-1',
      username: 'jsmith',
      displayName: 'Taylor Example',
    });
    await repo.setRoles(created.id, ['Sales', 'Billing']);
    const first = await repo.findById(created.id);
    expect(first?.roles).toEqual(['Sales', 'Billing']);

    await repo.setRoles(created.id, ['Admin']);
    const second = await repo.findById(created.id);
    expect(second?.roles).toEqual(['Admin']);
  });

  it('dedupes on the way in (a caller sending ["Sales","Sales"] persists as one)', async () => {
    const repo = new InMemoryUserRepository();
    const created = await repo.upsertFromIdentity({
      externalId: 'ad-guid-1',
      username: 'jsmith',
      displayName: 'Taylor Example',
    });
    const updated = await repo.setRoles(created.id, ['Sales', 'Sales', 'Billing']);
    expect(updated?.roles).toEqual(['Sales', 'Billing']);
  });
});

describe('InMemoryUserRepository.listByRole', () => {
  async function withUsers() {
    const repo = new InMemoryUserRepository();
    const zoe = await repo.upsertFromIdentity({
      externalId: 'ad-guid-z',
      username: 'zoe',
      displayName: 'Zoe Demo',
      email: 'zoe@example.test',
    });
    const adam = await repo.upsertFromIdentity({
      externalId: 'ad-guid-a',
      username: 'adam',
      displayName: 'Adam Example',
      email: 'adam@example.test',
    });
    const sam = await repo.upsertFromIdentity({
      externalId: 'ad-guid-s',
      username: 'sam',
      displayName: 'Sam Demo',
      email: 'sam@example.test',
    });
    await repo.setRoles(zoe.id, ['ProductionManager']);
    await repo.setRoles(adam.id, ['ProductionManager', 'Production']);
    await repo.setRoles(sam.id, ['Sales']);
    return { repo, zoe, adam, sam };
  }

  it('returns every holder, because the role is deliberately plural', async () => {
    const { repo } = await withUsers();

    const found = await repo.listByRole('ProductionManager');

    expect(found.map((u) => u.username)).toEqual(['adam', 'zoe']);
  });

  it('orders by username, so a recipient list is stable between calls', async () => {
    const { repo } = await withUsers();

    expect((await repo.listByRole('ProductionManager')).map((u) => u.username)).toEqual([
      'adam',
      'zoe',
    ]);
  });

  it('does not match a user holding only a different role', async () => {
    const { repo } = await withUsers();

    expect(await repo.listByRole('Admin')).toEqual([]);
    expect((await repo.listByRole('Sales')).map((u) => u.username)).toEqual(['sam']);
  });

  it('distinguishes ProductionManager from Production', async () => {
    const { repo } = await withUsers();

    expect((await repo.listByRole('Production')).map((u) => u.username)).toEqual(['adam']);
    expect((await repo.listByRole('ProductionManager')).map((u) => u.username)).toEqual([
      'adam',
      'zoe',
    ]);
  });
});
