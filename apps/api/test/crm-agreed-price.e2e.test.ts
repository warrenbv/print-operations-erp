// End-to-end over HTTP: a customer's agreed price for a part, its role gate, the actor from the session, and a stale write answered 409.
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
  const { CrmModule } = await import('../src/crm/crm.module');
  const moduleRef = await Test.createTestingModule({
    imports: [AuthModule, AdminModule, CrmModule],
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
});

afterAll(async () => {
  await app.close();
});

async function loginAgent(username: string, password: string): Promise<request.Agent> {
  const agent = request.agent(app.getHttpServer());
  const response = await agent.post('/auth/login').send({ username, password });
  expect(response.status).toBe(200);
  return agent;
}

const PAPER = '01988a00-0819-7000-8000-000000000001';
const OTHER_PAPER = '01988a00-0819-7000-8000-000000000002';
const MISSING = '01988a00-0819-7000-8000-00000000ffff';

async function customerWithParts(name: string): Promise<string> {
  const sales = await loginAgent('dev-sales', DEV_PASSWORD);
  const created = await sales.post('/crm/customers').send({ name });
  expect(created.status).toBe(201);
  const customerId = created.body.id as string;
  const saved = await sales.put(`/crm/customers/${customerId}/defaults`).send({
    lockVersion: 0,
    parts: [
      { gradeId: PAPER, rollWidthIn: 12, partNumber: 'TEST-12' },
      { gradeId: PAPER, rollWidthIn: 9.75, partNumber: 'TEST-9Q' },
    ],
  });
  expect(saved.status).toBe(200);
  return customerId;
}

const route = (customerId: string) => `/crm/customers/${customerId}/parts/agreed-price`;

describe('PUT /crm/customers/:id/parts/agreed-price', () => {
  it('lets Billing set one, stamped from the session, and every reader sees it', async () => {
    const customerId = await customerWithParts('Agreed Price Set Corp');
    const billing = await loginAgent('dev-billing', DEV_PASSWORD);

    const set = await billing.put(route(customerId)).send({
      gradeId: PAPER,
      rollWidthIn: 9.75,
      agreedPrice: { basis: 'per_pound', price: '0.69' },
      lockVersion: 1,

      setBy: 'somebody-else',
    });

    expect(set.status).toBe(200);
    expect(set.body.lockVersion).toBe(2);
    expect(set.body.parts[1].agreedPrice).toMatchObject({
      basis: 'per_pound',
      price: '0.6900',
      setBy: 'dev-billing',
    });
    expect(set.body.parts[0].agreedPrice).toBeUndefined();

    expect(set.body.updatedBy).toBe('dev-sales');

    const reader = await loginAgent('dev-production', DEV_PASSWORD);
    const read = await reader.get(`/crm/customers/${customerId}/defaults`);
    expect(read.body.parts[1].agreedPrice).toEqual(set.body.parts[1].agreedPrice);
  });

  it('refuses Sales with 403, and a role outside the gate', async () => {
    const customerId = await customerWithParts('Agreed Price Refused Corp');
    const body = {
      gradeId: PAPER,
      rollWidthIn: 12,
      agreedPrice: { basis: 'per_pound', price: '0.69' },
      lockVersion: 1,
    };
    const sales = await loginAgent('dev-sales', DEV_PASSWORD);
    expect((await sales.put(route(customerId)).send(body)).status).toBe(403);
    const production = await loginAgent('dev-production', DEV_PASSWORD);
    expect((await production.put(route(customerId)).send(body)).status).toBe(403);

    const read = await sales.get(`/crm/customers/${customerId}/defaults`);
    expect(read.body.parts[0].agreedPrice).toBeUndefined();
  });

  it('answers 404 for no part on that paper and width, and for no such customer', async () => {
    const customerId = await customerWithParts('Agreed Price Missing Corp');
    const billing = await loginAgent('dev-billing', DEV_PASSWORD);
    const body = {
      gradeId: OTHER_PAPER,
      rollWidthIn: 12,
      agreedPrice: { basis: 'per_roll', price: '23.75' },
      lockVersion: 1,
    };
    expect((await billing.put(route(customerId)).send(body)).status).toBe(404);
    expect(
      (await billing.put(route(customerId)).send({ ...body, gradeId: PAPER, rollWidthIn: 24 }))
        .status,
    ).toBe(404);
    expect((await billing.put(route(MISSING)).send(body)).status).toBe(404);
  });

  it('refuses a stale generation with 409 stale-aggregate', async () => {
    const customerId = await customerWithParts('Agreed Price Stale Corp');
    const billing = await loginAgent('dev-billing', DEV_PASSWORD);

    const stale = await billing.put(route(customerId)).send({
      gradeId: PAPER,
      rollWidthIn: 12,
      agreedPrice: { basis: 'per_pound', price: '0.69' },
      lockVersion: 0,
    });

    expect(stale.status).toBe(409);
    expect(stale.body).toMatchObject({
      reason: 'stale-aggregate',
      value: { expected: 0, actual: 1 },
    });
  });

  it('refuses a figure of 0 or past four places with 400', async () => {
    const customerId = await customerWithParts('Agreed Price Bad Corp');
    const billing = await loginAgent('dev-billing', DEV_PASSWORD);
    for (const price of ['0', '0.69001']) {
      const refused = await billing.put(route(customerId)).send({
        gradeId: PAPER,
        rollWidthIn: 12,
        agreedPrice: { basis: 'per_pound', price },
        lockVersion: 1,
      });
      expect(refused.status, price).toBe(400);
    }
  });

  it('removes one with null', async () => {
    const customerId = await customerWithParts('Agreed Price Removed Corp');
    const billing = await loginAgent('dev-billing', DEV_PASSWORD);
    await billing.put(route(customerId)).send({
      gradeId: PAPER,
      rollWidthIn: 12,
      agreedPrice: { basis: 'per_roll', price: '23.75' },
      lockVersion: 1,
    });

    const removed = await billing
      .put(route(customerId))
      .send({ gradeId: PAPER, rollWidthIn: 12, agreedPrice: null, lockVersion: 2 });

    expect(removed.status).toBe(200);
    expect(removed.body.parts[0]).toEqual({
      gradeId: PAPER,
      rollWidthIn: 12,
      partNumber: 'TEST-12',
    });
  });

  it('cannot be set, changed or kept alive through a Quote defaults save that sends one', async () => {
    const customerId = await customerWithParts('Agreed Price Smuggled Corp');
    const sales = await loginAgent('dev-sales', DEV_PASSWORD);
    const smuggled = {
      gradeId: PAPER,
      rollWidthIn: 12,
      partNumber: 'TEST-12',
      agreedPrice: {
        basis: 'per_pound',
        price: '0.0425',
        setBy: 'dev-sales',
        setAt: '2026-11-16T17:00:00.000Z',
      },
    };

    const first = await sales
      .put(`/crm/customers/${customerId}/defaults`)
      .send({ lockVersion: 1, parts: [smuggled] });
    expect(first.status).toBe(200);
    expect(first.body.parts[0].agreedPrice).toBeUndefined();

    const billing = await loginAgent('dev-billing', DEV_PASSWORD);
    await billing.put(route(customerId)).send({
      gradeId: PAPER,
      rollWidthIn: 12,
      agreedPrice: { basis: 'per_pound', price: '0.69' },
      lockVersion: 2,
    });
    const second = await sales
      .put(`/crm/customers/${customerId}/defaults`)
      .send({ lockVersion: 3, parts: [smuggled] });
    expect(second.status).toBe(200);
    expect(second.body.parts[0].agreedPrice).toMatchObject({
      price: '0.6900',
      setBy: 'dev-billing',
    });

    const moved = await sales
      .put(`/crm/customers/${customerId}/defaults`)
      .send({ lockVersion: 4, parts: [{ ...smuggled, rollWidthIn: 12.3125 }] });
    expect(moved.status).toBe(200);
    expect(moved.body.parts[0].agreedPrice).toBeUndefined();
  });
});
