// The Admin page's directory search when the local provider is in use. It lists the same accounts the
// local provider accepts, with the same identities, so assigning a role here matches a later sign-in.
import { normalizeUsername } from '../domain/username';
import type { LdapDirectory, LdapDirectoryUser } from './ldap-directory';
import { DEV_USERNAMES, devEmailFor } from './local-auth-provider';

export class LocalLdapDirectory implements LdapDirectory {
  readonly #users: readonly LdapDirectoryUser[];

  constructor(usernames: readonly string[] = DEV_USERNAMES) {
    this.#users = usernames.map((username) => {
      const normalized = normalizeUsername(username);
      return {
        externalId: `local:${normalized}`,
        username: normalized,
        displayName: normalized,

        email: devEmailFor(normalized),
        disabled: false,
      };
    });
  }

  async searchUsers(query: string, limit: number): Promise<readonly LdapDirectoryUser[]> {
    const needle = query.trim().toLowerCase();
    const matched =
      needle === ''
        ? this.#users
        : this.#users.filter(
            (u) =>
              u.username.includes(needle) ||
              u.displayName.toLowerCase().includes(needle) ||
              (u.email !== undefined && u.email.toLowerCase().includes(needle)),
          );
    return matched.slice(0, limit);
  }
}
