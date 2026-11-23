// Turns stored sales-rep usernames into display names, and says whether each is still offered as a rep.
// A current holder of the Sales role is offerable. Anyone else keeps their name, and an unknown value comes back as it is.
import type { UserRepository } from '@erp/identity';
import type { ResolvedSalesRep } from '@erp/types';

export async function resolveRepName(
  users: Pick<UserRepository, 'listByRole' | 'findByUsernames'>,
  username: string | undefined,
): Promise<string | undefined> {
  if (username === undefined) {
    return undefined;
  }
  const resolved = await resolveSalesReps(users, [username]);
  return resolved.get(username)?.displayName;
}

/** At most two reads whatever the number of names: the Sales holders, then one batched lookup for the rest. */
export async function resolveSalesReps(
  users: Pick<UserRepository, 'listByRole' | 'findByUsernames'>,
  usernames: readonly string[],
): Promise<ReadonlyMap<string, ResolvedSalesRep>> {
  const wanted = [...new Set(usernames)];
  if (wanted.length === 0) {
    return new Map();
  }

  const resolved = new Map<string, ResolvedSalesRep>();
  const offerable = await users.listByRole('Sales');
  const byUsername = new Map(offerable.map((user) => [user.username, user]));
  const missing: string[] = [];
  for (const username of wanted) {
    const holder = byUsername.get(username);
    if (holder === undefined) {
      missing.push(username);
      continue;
    }
    resolved.set(username, { username, displayName: holder.displayName, offerable: true });
  }

  if (missing.length > 0) {
    const found = await users.findByUsernames(missing);
    for (const user of found) {
      resolved.set(user.username, {
        username: user.username,
        displayName: user.displayName,
        offerable: false,
      });
    }
  }

  for (const username of wanted) {
    if (!resolved.has(username)) {
      resolved.set(username, { username, offerable: false });
    }
  }
  return resolved;
}
