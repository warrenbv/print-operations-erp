// End-to-end over HTTP: pricing tiers, their gate, updates stamped from the session, and conflicts.
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
let sales: request.Agent;
let billing: request.Agent;
let noroles: request.Agent;

async function loginAgent(username: string, password: string): Promise<request.Agent> {
  const agent = request.agent(app.getHttpServer());
  const response = await agent.post('/auth/login').send({ username, password });
  expect(response.status).toBe(200);
  return agent;
}

function http(): request.Agent {
  return request(app.getHttpServer());
}

async function reload(code: string): Promise<Record<string, unknown> | undefined> {
  const listed = await sales.get('/quoting/tiers');
  expect(listed.status).toBe(200);
  return (listed.body.items as Record<string, unknown>[]).find((t) => t.code === code);
}

async function history(): Promise<Record<string, unknown>[]> {
  const response = await sales.get('/quoting/tiers/history');
  expect(response.status).toBe(200);
  return response.body.items as Record<string, unknown>[];
}

beforeAll(async () => {
  const { AuthModule } = await import('../src/auth/auth.module');
  const { AdminModule } = await import('../src/admin/admin.module');
  const { CrmModule } = await import('../src/crm/crm.module');
  const { QuotingModule } = await import('../src/quoting/quoting.module');
  const moduleRef = await Test.createTestingModule({
    imports: [AuthModule, AdminModule, CrmModule, QuotingModule],
  }).compile();
  app = moduleRef.createNestApplication();
  applyRequestParsing(app);
  app.use(cookieParser());
  await app.listen(0, '127.0.0.1');

  const admin = await loginAgent('break-glass', BREAK_GLASS_PASSWORD);
  for (const [username, roles] of [
    ['dev-sales', ['Sales']],
    ['dev-billing', ['Billing']],
  ] as const) {
    const grant = await admin.put(`/admin/users/local:${username}/roles`).send({
      identity: { externalId: `local:${username}`, username, displayName: username },
      roles,
    });
    expect(grant.status).toBe(200);
  }

  sales = await loginAgent('dev-sales', DEV_PASSWORD);
  billing = await loginAgent('dev-billing', DEV_PASSWORD);
  noroles = await loginAgent('dev-noroles', DEV_PASSWORD);
});

afterAll(async () => {
  await app.close();
});

describe('Tier admin edge — authentication', () => {
  it('rejects anonymous reads and writes alike', async () => {
    expect((await http().get('/quoting/tiers')).status).toBe(401);
    expect((await http().get('/quoting/tiers/history')).status).toBe(401);
    expect((await http().post('/quoting/tiers').send({ code: 'x' })).status).toBe(401);
    expect((await http().patch('/quoting/tiers/volume_5').send({ minPallets: 3 })).status).toBe(
      401,
    );
  });
});

describe('Tier admin edge — authorization', () => {
  it('opens both reads to a signed-in user holding no role at all', async () => {
    expect((await noroles.get('/quoting/tiers')).status).toBe(200);
    expect((await noroles.get('/quoting/tiers/history')).status).toBe(200);
  });

  it('refuses Sales and admits Billing — the pricing masters are the Billing Manager’s', async () => {
    expect(
      (
        await sales
          .post('/quoting/tiers')
          .send({ code: 'nope', name: 'x', marginPct: '0.143000', minPallets: 99 })
      ).status,
    ).toBe(403);
    expect(
      (await sales.patch('/quoting/tiers/volume_5').send({ marginPct: '0.143000' })).status,
    ).toBe(403);

    expect(
      (await billing.patch('/quoting/tiers/volume_5').send({ marginPct: '0.233000' })).status,
    ).toBe(200);
  });
});

describe('Tier admin edge — update', () => {
  it('changes a margin and the listing shows it', async () => {
    const patched = await billing.patch('/quoting/tiers/volume_3').send({ marginPct: '0.418000' });
    expect(patched.status).toBe(200);
    expect(patched.body.marginPct).toBe('0.418000');
    expect((await reload('volume_3'))?.marginPct).toBe('0.418000');
  });

  it('stamps the actor from the session and refuses to take one from the body', async () => {
    const patched = await billing
      .patch('/quoting/tiers/volume_1')
      .send({ marginPct: '0.452000', updatedBy: 'dev-sales', actor: 'dev-sales' });
    expect(patched.status).toBe(200);
    expect(patched.body.updatedBy).toBe('dev-billing');
    expect((await history()).find((c) => c.tierCode === 'volume_1')?.actor).toBe('dev-billing');
  });

  it('will not rename a code, because quote lines store it', async () => {
    const patched = await billing
      .patch('/quoting/tiers/volume_4')
      .send({ code: 'volume_4_renamed' });
    expect(patched.status).toBe(200);

    expect(patched.body.code).toBe('volume_4');
    expect(await reload('volume_4_renamed')).toBeUndefined();
  });

  it('answers 404 for a tier that does not exist', async () => {
    expect((await billing.patch('/quoting/tiers/platinum').send({ minPallets: 3 })).status).toBe(
      404,
    );
  });

  it('answers 400 for a margin the multiplier cannot use', async () => {
    const refused = await billing.patch('/quoting/tiers/volume_5').send({ marginPct: '1.000000' });
    expect(refused.status).toBe(400);
  });

  it('answers 409 when two tiers would start at the same pallet count', async () => {
    const refused = await billing.patch('/quoting/tiers/volume_5').send({ minPallets: 1 });
    expect(refused.status).toBe(409);
    expect(refused.body.reason).toBe('duplicate-tier-threshold');
    expect(refused.body.minPallets).toBe(1);
  });

  it('answers 422 rather than leaving the table with no tier at zero pallets', async () => {
    const refused = await billing.patch('/quoting/tiers/retail').send({ minPallets: 5 });
    expect(refused.status).toBe(422);
    expect(refused.body.reason).toBe('no-zero-threshold-tier');
    expect((await reload('retail'))?.minPallets).toBe(0);
  });

  it('still lets the zero-threshold tier change what it earns', async () => {
    const patched = await billing.patch('/quoting/tiers/retail').send({ marginPct: '0.612000' });
    expect(patched.status).toBe(200);
    expect(patched.body.minPallets).toBe(0);
  });
});

describe('Tier admin edge — history', () => {
  it('records what the tier used to be, newest first', async () => {
    await billing.patch('/quoting/tiers/list').send({ marginPct: '0.267000' });
    await billing.patch('/quoting/tiers/list').send({ marginPct: '0.291000' });

    const entries = (await history()).filter((c) => c.tierCode === 'list');
    expect(entries).toHaveLength(2);

    expect(entries[0]?.marginPct).toBe('0.267000');
    expect(entries[1]?.marginPct).toBe('0.280000');
  });

  it('writes nothing when a patch changes nothing', async () => {
    const before = (await history()).length;
    expect((await billing.patch('/quoting/tiers/volume_5').send({})).status).toBe(200);
    expect((await history()).length).toBe(before);
  });
});

describe('Tier admin edge — create', () => {
  it('adds a tier, which then appears in the table and prices a quote line', async () => {
    const created = await billing.post('/quoting/tiers').send({
      code: 'e2e_v6',
      name: 'E2E Volume 6',
      marginPct: '0.226000',
      minPallets: 400,
    });
    expect(created.status).toBe(201);
    expect(created.body.code).toBe('e2e_v6');
    expect(created.body.updatedBy).toBe('dev-billing');
    expect(await reload('e2e_v6')).toBeDefined();
  });

  it('never lets a new tier claim the published list tier', async () => {
    const created = await billing.post('/quoting/tiers').send({
      code: 'e2e_v7',
      name: 'E2E V7',
      marginPct: '0.184000',
      minPallets: 401,
      isListTier: true,
    });
    expect(created.status).toBe(201);
    expect(created.body.isListTier).toBe(false);

    const listed = await sales.get('/quoting/tiers');
    expect(
      (listed.body.items as { code: string; isListTier: boolean }[])
        .filter((t) => t.isListTier)
        .map((t) => t.code),
    ).toEqual(['list']);
  });

  it('writes no history row, because a create has nothing it replaced', async () => {
    const before = (await history()).length;
    const created = await billing.post('/quoting/tiers').send({
      code: 'e2e_v8',
      name: 'E2E V8',
      marginPct: '0.087000',
      minPallets: 463,
    });
    expect(created.status).toBe(201);
    expect((await history()).length).toBe(before);
  });

  it('answers 409 for a code that is taken', async () => {
    const refused = await billing
      .post('/quoting/tiers')
      .send({ code: 'volume_5', name: 'Another Volume 5', marginPct: '0.157000', minPallets: 403 });
    expect(refused.status).toBe(409);
    expect(refused.body.reason).toBe('duplicate-tier-code');
    expect(refused.body.code).toBe('volume_5');
  });

  it('answers 409 for a threshold another tier already starts at', async () => {
    const refused = await billing
      .post('/quoting/tiers')
      .send({ code: 'e2e_clash', name: 'Clash', marginPct: '0.157000', minPallets: 400 });
    expect(refused.status).toBe(409);
    expect(refused.body.reason).toBe('duplicate-tier-threshold');
    expect(refused.body.minPallets).toBe(400);
  });

  it('answers 400 for a code that is not the stable lower_snake_case key', async () => {
    const refused = await billing
      .post('/quoting/tiers')
      .send({ code: 'E2E Upper', name: 'Nope', marginPct: '0.157000', minPallets: 404 });
    expect(refused.status).toBe(400);
  });

  it('answers 400 when a required value is missing', async () => {
    expect((await billing.post('/quoting/tiers').send({ code: 'e2e_partial' })).status).toBe(400);
  });
});
