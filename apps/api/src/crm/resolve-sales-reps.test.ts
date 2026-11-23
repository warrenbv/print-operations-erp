// Tests `resolveSalesReps` in apps/api/src/crm/resolve-sales-reps.ts against a stub user repository.
import type { ErpUser, UserRepository } from '@erp/identity';
import { describe, expect, it, vi } from 'vitest';

import { resolveSalesReps } from './resolve-sales-reps';

function user(username: string, displayName: string): ErpUser {
  return {
    id: `id-${username}`,
    externalId: `ext-${username}`,
    username,
    displayName,
    email: `${username}@example.test`,
    roles: ['Sales'],
  };
}

function repository(
  offerable: readonly ErpUser[],
  others: readonly ErpUser[] = [],
): Pick<UserRepository, 'listByRole' | 'findByUsernames'> & {
  listByRole: ReturnType<typeof vi.fn>;
  findByUsernames: ReturnType<typeof vi.fn>;
} {
  return {
    listByRole: vi.fn(async () => offerable),
    findByUsernames: vi.fn(async (names: readonly string[]) =>
      others.filter((candidate) => names.includes(candidate.username)),
    ),
  };
}

describe('resolveSalesReps', () => {
  it('reads nothing at all when there are no reps to resolve', async () => {
    const users = repository([]);
    expect(await resolveSalesReps(users, [])).toEqual(new Map());
    expect(users.listByRole).not.toHaveBeenCalled();
    expect(users.findByUsernames).not.toHaveBeenCalled();
  });

  it('answers a current holder from the offerable list, with no second read', async () => {
    const users = repository([user('jsmith', 'Jordan Example')]);

    const resolved = await resolveSalesReps(users, ['jsmith']);

    expect(resolved.get('jsmith')).toEqual({
      username: 'jsmith',
      displayName: 'Jordan Example',
      offerable: true,
    });
    expect(users.findByUsernames).not.toHaveBeenCalled();
  });

  it('names somebody who has left Sales, and does not offer them', async () => {
    const users = repository([user('jsmith', 'Jordan Example')], [user('dgreen', 'Dana Example')]);

    const resolved = await resolveSalesReps(users, ['jsmith', 'dgreen']);

    expect(resolved.get('dgreen')).toEqual({
      username: 'dgreen',
      displayName: 'Dana Example',
      offerable: false,
    });
  });

  it('asks for every leftover in ONE batched read, never a loop', async () => {
    const users = repository([], [user('a', 'A Person'), user('b', 'B Person')]);

    await resolveSalesReps(users, ['a', 'b', 'c']);

    expect(users.findByUsernames).toHaveBeenCalledTimes(1);
    expect(users.findByUsernames).toHaveBeenCalledWith(['a', 'b', 'c']);
  });

  it('returns a value nobody knows with no display name, rather than throwing', async () => {
    const users = repository([]);

    const resolved = await resolveSalesReps(users, ['Jane from Acme']);

    expect(resolved.get('Jane from Acme')).toEqual({
      username: 'Jane from Acme',
      offerable: false,
    });
  });

  it('answers every name it was asked about, once, even with duplicates', async () => {
    const users = repository([user('jsmith', 'Jordan Example')]);

    const resolved = await resolveSalesReps(users, ['jsmith', 'jsmith', 'ghost']);

    expect([...resolved.keys()].sort()).toEqual(['ghost', 'jsmith']);
    expect(users.findByUsernames).toHaveBeenCalledWith(['ghost']);
  });
});
