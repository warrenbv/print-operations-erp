// End-to-end over HTTP: an Admin role grant that sends another username never renames the account, so a session the
// read-only account already holds stays read-only. A grant does refresh the display name and email the roles page and
// the alerts read. The route refuses the break-glass account's external id and its reserved name.
// The grant is modules/identity/src/admin-role-service.ts. The read-only rule is apps/api/src/auth/roles.guard.ts.
import { BREAK_GLASS_EXTERNAL_ID, DEV_USERNAMES } from '@erp/identity';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { applyRequestParsing } from '../src/config/request-parsing';

const DEV_PASSWORD = 'grant-check-password';
const READ_ONLY_USER = 'dev-noroles';
const WRITER = 'dev-billing';

process.env.NODE_ENV = 'test';
process.env.AUTH_PROVIDER = 'local';
process.env.DATA_PERSISTENCE = 'memory';
process.env.LOCAL_AUTH_PASSWORD = DEV_PASSWORD;
process.env.LOCAL_AUTH_USERS = DEV_USERNAMES.join(',');
process.env.DEV_SEED_ROLES = 'true';
process.env.SESSION_COOKIE_INSECURE = 'true';
process.env.READ_ONLY_USERS = READ_ONLY_USER;

let app: INestApplication;

beforeAll(async () => {
  const { AuthModule } = await import('../src/auth/auth.module');
  const { AdminModule } = await import('../src/admin/admin.module');
  const { OrdersModule } = await import('../src/orders/orders.module');
  const moduleRef = await Test.createTestingModule({
    imports: [AuthModule, AdminModule, OrdersModule],
  }).compile();
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
  const login = await agent.post('/auth/login').send({ username, password: DEV_PASSWORD });
  expect(login.status).toBe(200);
  return agent;
}

describe('an Admin grant that sends another username for the read-only account', () => {
  it('leaves its live session refused a write, under its own name', async () => {
    const readOnly = await signIn(READ_ONLY_USER);
    const admin = await signIn('dev-admin');

    const grant = await admin.put(`/admin/users/local:${READ_ONLY_USER}/roles`).send({
      identity: {
        externalId: `local:${READ_ONLY_USER}`,
        username: WRITER,
        displayName: WRITER,
      },
      roles: ['Sales'],
    });

    expect(grant.status).toBe(200);
    expect((await readOnly.post('/orders').send({})).status).toBe(403);
    expect((await readOnly.get('/auth/me')).body.username).toBe(READ_ONLY_USER);
    expect(grant.body.user.username).toBe(READ_ONLY_USER);
  });
});

describe('an Admin grant to a person who has signed in', () => {
  it('refreshes the display name and email the roles page and the alerts read, and keeps the username', async () => {
    await signIn('dev-production');
    const admin = await signIn('dev-admin');

    const grant = await admin.put('/admin/users/local:dev-production/roles').send({
      identity: {
        externalId: 'local:dev-production',
        username: WRITER,
        displayName: 'Press Floor Lead',
        email: 'press.floor.lead@example.test',
      },
      roles: ['ProductionManager'],
    });
    expect(grant.status).toBe(200);

    const catalog = await admin.get('/admin/roles');
    const managers = catalog.body.items.find(
      (entry: { role: string }) => entry.role === 'ProductionManager',
    );
    expect(managers.holders).toContainEqual({
      externalId: 'local:dev-production',
      username: 'dev-production',
      displayName: 'Press Floor Lead',
      email: 'press.floor.lead@example.test',
    });
  });
});

describe('PUT /admin/users/:externalId/roles with the reserved break-glass name', () => {
  it('is refused with directory-mismatch for a person who exists and for a new external id', async () => {
    const admin = await signIn('dev-admin');

    for (const externalId of ['local:dev-sales', 'guid-reserved-claimant']) {
      const response = await admin.put(`/admin/users/${externalId}/roles`).send({
        identity: { externalId, username: 'break-glass', displayName: 'Reserved Claimant' },
        roles: ['Admin'],
      });

      expect(response.status, externalId).toBe(400);
      expect(response.body, externalId).toEqual({ reason: 'directory-mismatch' });
    }

    const catalog = await admin.get('/admin/roles');
    const admins = catalog.body.items.find((entry: { role: string }) => entry.role === 'Admin');
    expect(admins.holders.map((holder: { username: string }) => holder.username)).toEqual([
      'dev-admin',
    ]);
  });
});

describe('PUT /admin/users/:externalId/roles for the break-glass account', () => {
  it('is refused with directory-mismatch', async () => {
    const admin = await signIn('dev-admin');

    const response = await admin.put(`/admin/users/${BREAK_GLASS_EXTERNAL_ID}/roles`).send({
      identity: {
        externalId: BREAK_GLASS_EXTERNAL_ID,
        username: WRITER,
        displayName: WRITER,
      },
      roles: ['Sales'],
    });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ reason: 'directory-mismatch' });
  });
});
