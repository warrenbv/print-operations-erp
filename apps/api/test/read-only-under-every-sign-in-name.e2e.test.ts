// End-to-end over HTTP with directory sign-in: an account named in READ_ONLY_USERS by its account name is refused
// a write whichever of its two sign-in names it uses, and a session it already holds stays read-only.
// The directory is scripted. The provider is modules/identity/src/providers/ldap-auth-provider.ts. The same rule
// with the local provider: apps/api/test/read-only-account.e2e.test.ts.
import {
  AuthenticationService,
  InMemoryBreakGlassStore,
  LdapAuthProvider,
  systemClock,
  type LdapClientFactory,
  type LdapConfig,
  type LdapUserEntry,
} from '@erp/identity';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { applyRequestParsing } from '../src/config/request-parsing';
import { IDENTITY_STORES, type IdentityStores } from '../src/auth/auth.factory';

const PASSWORD = 'directory-password';

process.env.NODE_ENV = 'test';
process.env.AUTH_PROVIDER = 'ldap';
process.env.DATA_PERSISTENCE = 'memory';
process.env.SESSION_COOKIE_INSECURE = 'true';
process.env.READ_ONLY_USERS = 'Case.Auditor';

interface Account {
  entry: LdapUserEntry;
  principalName: string;
}

const AUDITOR: Account = {
  entry: {
    dn: 'CN=Case Auditor,OU=Staff,DC=example,DC=test',
    objectGuid: '0b8e4d2f6a1c47e3b95d28c4f7a06e19',
    sAMAccountName: 'Case.Auditor',
    displayName: 'Case Auditor',
    mail: 'case.auditor@example.test',
    userAccountControl: 0x0200,
  },
  principalName: 'case.auditor@example.test',
};

const CLERK: Account = {
  entry: {
    dn: 'CN=Order Clerk,OU=Staff,DC=example,DC=test',
    objectGuid: 'e47a90c3d1f2485b8c6e0a9b3d5f7c21',
    sAMAccountName: 'order.clerk',
    displayName: 'Order Clerk',
    userAccountControl: 0x0200,
  },
  principalName: 'order.clerk@example.test',
};

const CONFIG: LdapConfig = {
  urls: ['ldaps://dc.example.test:636'],
  bindDn: 'CN=lookup,DC=example,DC=test',
  bindPassword: 'lookup-password',
  userBaseDn: 'OU=Staff,DC=example,DC=test',
  caCertificate: Buffer.from('ca'),
  timeoutMs: 1000,
};

// A search answers the entries whose account name or principal name the filter names.
const directory: LdapClientFactory = async () => ({
  bind: async () => {},
  search: async (_baseDn, filter) => {
    const asked = [...filter.matchAll(/(sAMAccountName|userPrincipalName)=([^)]*)\)/g)];
    return [AUDITOR, CLERK]
      .filter((account) =>
        asked.some(
          ([, attribute, value]) =>
            (attribute === 'sAMAccountName' &&
              value === account.entry.sAMAccountName.toLowerCase()) ||
            (attribute === 'userPrincipalName' && value === account.principalName),
        ),
      )
      .map((account) => account.entry);
  },
  unbind: async () => {},
});

let app: INestApplication;

beforeAll(async () => {
  const { AuthModule } = await import('../src/auth/auth.module');
  const { OrdersModule } = await import('../src/orders/orders.module');
  const moduleRef = await Test.createTestingModule({
    imports: [AuthModule, OrdersModule],
  })
    .overrideProvider(AuthenticationService)
    .useFactory({
      factory: (stores: IdentityStores) =>
        new AuthenticationService({
          provider: new LdapAuthProvider(CONFIG, directory),
          users: stores.users,
          sessions: stores.sessions,
          breakGlass: new InMemoryBreakGlassStore(null),
          hasher: { hash: async (p) => p, verify: async () => false },
          audit: { record: async () => undefined },
          alerts: { raise: async () => undefined },
          clock: systemClock,
          breakGlassUsername: 'break-glass',
        }),
      inject: [IDENTITY_STORES],
    })
    .compile();
  app = moduleRef.createNestApplication();
  applyRequestParsing(app);
  app.use(cookieParser());
  await app.listen(0, '127.0.0.1');
});

afterAll(async () => {
  await app.close();
});

async function signIn(username: string): Promise<request.Agent> {
  const agent = request.agent(app.getHttpServer());
  const login = await agent.post('/auth/login').send({ username, password: PASSWORD });
  expect(login.status).toBe(200);
  return agent;
}

describe('a directory account named in READ_ONLY_USERS by its account name', () => {
  it('is refused POST /orders when signed in under its account name', async () => {
    const agent = await signIn('case.auditor');
    expect((await agent.post('/orders').send({})).status).toBe(403);
    expect((await agent.get('/auth/me')).body.username).toBe('case.auditor');
  });

  it('is refused POST /orders when signed in under its principal name', async () => {
    const agent = await signIn(AUDITOR.principalName);
    expect((await agent.post('/orders').send({})).status).toBe(403);
    expect((await agent.get('/auth/me')).body.username).toBe('case.auditor');
  });

  it('keeps an earlier session read-only after signing in under its other name', async () => {
    const earlier = await signIn('Case.Auditor');
    await signIn(AUDITOR.principalName);
    expect((await earlier.get('/orders')).status).toBe(200);
    expect((await earlier.post('/orders').send({})).status).toBe(403);
  });
});

describe('a directory account not named in READ_ONLY_USERS', () => {
  it('reaches POST /orders under its principal name and is refused by the route, not by the rule', async () => {
    const agent = await signIn(CLERK.principalName);
    expect((await agent.post('/orders').send({})).status).toBe(400);
  });
});
