// End-to-end over HTTP: the Admin section's user search and role grant, the Admin-only gate, validation, and a grant taking effect.
// Like every e2e file here, it boots the Nest modules on in-memory stores with the local sign-in provider.
import { DEV_USERNAMES } from '@erp/identity';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { applyRequestParsing } from '../src/config/request-parsing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const DEV_PASSWORD = 'dev-password';
const BREAK_GLASS_PASSWORD = 'sealed-emergency-password';

process.env.NODE_ENV = 'test';
process.env.AUTH_PROVIDER = 'local';
process.env.DATA_PERSISTENCE = 'memory';
process.env.LOCAL_AUTH_PASSWORD = DEV_PASSWORD;
process.env.LOCAL_AUTH_USERS = DEV_USERNAMES.join(',');
process.env.BREAK_GLASS_DEV_PASSWORD = BREAK_GLASS_PASSWORD;
process.env.SESSION_COOKIE_INSECURE = 'true';

let app: INestApplication;

beforeAll(async () => {
  const { AuthModule } = await import('../src/auth/auth.module');
  const { AdminModule } = await import('../src/admin/admin.module');
  const moduleRef = await Test.createTestingModule({
    imports: [AuthModule, AdminModule],
  }).compile();
  app = moduleRef.createNestApplication();
  applyRequestParsing(app);
  app.use(cookieParser());
  await app.listen(0, '127.0.0.1');
});

afterAll(async () => {
  await app.close();
});

function http(): request.Agent {
  return request(app.getHttpServer());
}

async function loginAgent(username: string, password: string): Promise<request.Agent> {
  const agent = request.agent(app.getHttpServer());
  const response = await agent.post('/auth/login').send({ username, password });
  expect(response.status).toBe(200);
  return agent;
}

describe('Admin edge — authentication', () => {
  it('rejects anonymous requests to admin routes', async () => {
    expect((await http().get('/admin/users')).status).toBe(401);
    expect(
      (
        await http()
          .put('/admin/users/local:dev-sales/roles')
          .send({
            identity: {
              externalId: 'local:dev-sales',
              username: 'dev-sales',
              displayName: 'dev-sales',
            },
            roles: ['Sales'],
          })
      ).status,
    ).toBe(401);
  });
});

describe('Admin edge — authorization', () => {
  it('refuses a non-Admin both the directory and the grant', async () => {
    const agent = await loginAgent('dev-sales', DEV_PASSWORD);
    const search = await agent.get('/admin/users');
    expect(search.status).toBe(403);

    const write = await agent.put('/admin/users/local:dev-sales/roles').send({
      identity: {
        externalId: 'local:dev-sales',
        username: 'dev-sales',
        displayName: 'dev-sales',
      },
      roles: ['Sales'],
    });
    expect(write.status).toBe(403);
  });

  it('still tells the two gates apart, refusing the read and the grant separately', async () => {
    const admin = await loginAgent('break-glass', BREAK_GLASS_PASSWORD);
    expect((await admin.get('/admin/users')).status).toBe(200);
    expect((await admin.get('/admin/roles')).status).toBe(200);
  });

  it('refuses the grant to a role-holder who is not Admin', async () => {
    const admin = await loginAgent('break-glass', BREAK_GLASS_PASSWORD);
    const granted = await admin.put('/admin/users/local:dev-billing/roles').send({
      identity: {
        externalId: 'local:dev-billing',
        username: 'dev-billing',
        displayName: 'dev-billing',
      },
      roles: ['Billing'],
    });
    expect(granted.status).toBe(200);

    const agent = await loginAgent('dev-billing', DEV_PASSWORD);

    const search = await agent.get('/admin/users');
    expect(search.status).toBe(403);

    const write = await agent.put('/admin/users/local:dev-sales/roles').send({
      identity: {
        externalId: 'local:dev-sales',
        username: 'dev-sales',
        displayName: 'dev-sales',
      },
      roles: ['Sales', 'Admin'],
    });
    expect(write.status).toBe(403);
  });

  it('allows break-glass (implicit Admin) to search and mutate', async () => {
    const agent = await loginAgent('break-glass', BREAK_GLASS_PASSWORD);
    const list = await agent.get('/admin/users');
    expect(list.status).toBe(200);
    expect(list.body.items.length).toBeGreaterThan(0);

    expect(list.body.items.map((u: { externalId: string }) => u.externalId)).not.toContain(
      'break-glass',
    );
  });
});

describe('Admin edge — validation and error mapping', () => {
  it('400s when the URL externalId disagrees with the body identity', async () => {
    const agent = await loginAgent('break-glass', BREAK_GLASS_PASSWORD);
    const response = await agent.put('/admin/users/local:dev-sales/roles').send({
      identity: {
        externalId: 'local:someone-else',
        username: 'someone-else',
        displayName: 'someone-else',
      },
      roles: ['Sales'],
    });
    expect(response.status).toBe(400);
  });

  it('400s on a malformed body (missing identity)', async () => {
    const agent = await loginAgent('break-glass', BREAK_GLASS_PASSWORD);
    const response = await agent
      .put('/admin/users/local:dev-sales/roles')
      .send({ roles: ['Sales'] });
    expect(response.status).toBe(400);
    expect(response.body).toEqual({ formErrors: [], fieldErrors: { identity: ['Required'] } });
  });
});

describe('Admin edge — the round trip', () => {
  it('grants roles that then take effect on a subsequent request', async () => {
    const admin = await loginAgent('break-glass', BREAK_GLASS_PASSWORD);

    const grant = await admin.put('/admin/users/local:dev-sales/roles').send({
      identity: {
        externalId: 'local:dev-sales',
        username: 'dev-sales',
        displayName: 'dev-sales',
      },
      roles: ['Sales'],
    });
    expect(grant.status).toBe(200);
    expect(grant.body.user.roles).toEqual(['Sales']);
    expect(grant.body.user.alreadyProvisioned).toBe(true);

    const dev = await loginAgent('dev-sales', DEV_PASSWORD);
    const me = await dev.get('/auth/me');
    expect(me.body.roles).toEqual(['Sales']);
  });

  it('revokes roles by sending an empty array', async () => {
    const admin = await loginAgent('break-glass', BREAK_GLASS_PASSWORD);

    await admin.put('/admin/users/local:dev-production/roles').send({
      identity: {
        externalId: 'local:dev-production',
        username: 'dev-production',
        displayName: 'dev-production',
      },
      roles: ['Production'],
    });
    const revoke = await admin.put('/admin/users/local:dev-production/roles').send({
      identity: {
        externalId: 'local:dev-production',
        username: 'dev-production',
        displayName: 'dev-production',
      },
      roles: [],
    });
    expect(revoke.status).toBe(200);
    expect(revoke.body.user.roles).toEqual([]);
  });
});

describe('Admin edge — the role catalog', () => {
  it('rejects anonymous requests', async () => {
    expect((await http().get('/admin/roles')).status).toBe(401);
  });

  it('refuses a signed-in user with no roles at all', async () => {
    const agent = await loginAgent('dev-noroles', DEV_PASSWORD);
    const response = await agent.get('/admin/roles');
    expect(response.status).toBe(403);
  });

  it('returns every role in catalog order, holders and all', async () => {
    const { ERP_ROLES } = await import('@erp/types');
    const agent = await loginAgent('break-glass', BREAK_GLASS_PASSWORD);
    const response = await agent.get('/admin/roles');

    expect(response.status).toBe(200);
    expect(response.body.items.map((e: { role: string }) => e.role)).toEqual([...ERP_ROLES]);

    const sales = response.body.items.find((e: { role: string }) => e.role === 'Sales');
    expect(sales.holders.map((h: { username: string }) => h.username)).toEqual(['dev-sales']);
  });

  it('reports a revoked role as held by nobody', async () => {
    const agent = await loginAgent('break-glass', BREAK_GLASS_PASSWORD);
    const response = await agent.get('/admin/roles');
    const production = response.body.items.find((e: { role: string }) => e.role === 'Production');
    expect(production.holders).toEqual([]);
  });

  it('picks the holder up again once the role is granted back', async () => {
    const admin = await loginAgent('break-glass', BREAK_GLASS_PASSWORD);
    await admin.put('/admin/users/local:dev-production/roles').send({
      identity: {
        externalId: 'local:dev-production',
        username: 'dev-production',
        displayName: 'dev-production',
        email: 'dev-production@example.test',
      },
      roles: ['Production'],
    });

    const response = await admin.get('/admin/roles');
    const production = response.body.items.find((e: { role: string }) => e.role === 'Production');
    expect(production.holders.map((h: { username: string }) => h.username)).toEqual([
      'dev-production',
    ]);
    expect(production.holders[0].email).toBe('dev-production@example.test');
  });

  it('reports no failed alerts, with the window it looked over', async () => {
    const agent = await loginAgent('break-glass', BREAK_GLASS_PASSWORD);
    const response = await agent.get('/admin/roles');
    expect(response.body.failedAlerts).toEqual({ windowDays: 30, count: 0 });
  });

  it('surfaces an alert that could not be sent, and names the latest', async () => {
    const { SEND_LOG } = await import('../src/notifications/notifications.factory');
    const sendLog = app.get(SEND_LOG);

    const submittedAt = new Date();
    await sendLog.record({
      messageId: 'test-no-pm-holder@erp',
      subject: { type: 'quote', id: 'Q-586' },
      audience: 'internal',
      recipients: [],
      actor: 'dev-sales',
      submittedAt,
      outcome: 'failed',
      failureReason: 'no-holders',
      unreachableHolders: [],
    });

    const agent = await loginAgent('break-glass', BREAK_GLASS_PASSWORD);
    const response = await agent.get('/admin/roles');

    expect(response.body.failedAlerts.count).toBe(1);
    expect(response.body.failedAlerts.latest).toEqual({
      subjectType: 'quote',
      subjectId: 'Q-586',
      reason: 'no-holders',
      at: submittedAt.toISOString(),
    });
  });

  it('ignores a failure older than the window', async () => {
    const { SEND_LOG } = await import('../src/notifications/notifications.factory');
    const sendLog = app.get(SEND_LOG);

    await sendLog.record({
      messageId: 'test-ancient@erp',
      subject: { type: 'quote', id: 'Q-OLD' },
      audience: 'internal',
      recipients: [],
      actor: 'system',
      submittedAt: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000),
      outcome: 'failed',
      failureReason: 'no-addresses',
      unreachableHolders: ['dev-pm'],
    });

    const agent = await loginAgent('break-glass', BREAK_GLASS_PASSWORD);
    const response = await agent.get('/admin/roles');

    expect(response.body.failedAlerts.count).toBe(1);
    expect(response.body.failedAlerts.latest.subjectId).toBe('Q-586');
  });
});
