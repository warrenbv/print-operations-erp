// Chooses what the Users page shows: the list, no matches, or the directory being unavailable.
// A null list means the directory did not answer.
import type { AdminUserRow } from '@erp/types';

export type UsersView =
  | { readonly kind: 'directory-unavailable' }
  | { readonly kind: 'no-matches' }
  | { readonly kind: 'list'; readonly rows: readonly AdminUserRow[] };

export const DIRECTORY_UNAVAILABLE_MESSAGE =
  'The user directory is unavailable, so this list cannot be loaded right now. ' +
  'Try again in a few minutes, and call IT if it keeps happening.';

export function usersView(users: readonly AdminUserRow[] | null): UsersView {
  if (users === null) return { kind: 'directory-unavailable' };
  if (users.length === 0) return { kind: 'no-matches' };
  return { kind: 'list', rows: users };
}
