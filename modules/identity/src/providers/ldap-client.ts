// The port between the directory code and an LDAP library. The adapter is
// modules/identity/src/adapters/ldapts-client.ts. Its two errors map to the two sign-in failure
// reasons in packages/types/src/auth.ts.
export interface LdapUserEntry {
  dn: string;

  // The entry's objectGUID bytes as lower-case hex, used as the user's external id.
  objectGuid: string;

  sAMAccountName: string;
  displayName: string;
  mail?: string;

  userAccountControl: number;
}

export interface LdapClient {
  bind(dn: string, password: string): Promise<void>;

  search(baseDn: string, filter: string): Promise<readonly LdapUserEntry[]>;
  unbind(): Promise<void>;
}

export type LdapClientFactory = (url: string) => Promise<LdapClient>;

export class LdapInvalidCredentialsError extends Error {
  constructor(message = 'LDAP bind rejected') {
    super(message);
    this.name = 'LdapInvalidCredentialsError';
  }
}

export class LdapUnreachableError extends Error {
  constructor(message = 'LDAP directory unreachable') {
    super(message);
    this.name = 'LdapUnreachableError';
  }
}
