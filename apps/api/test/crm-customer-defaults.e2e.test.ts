// End-to-end over HTTP: a customer's quoting defaults and parts, the save gate, validation and a stale write answered 409.
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

async function seedCustomer(agent: request.Agent, name: string): Promise<string> {
  const response = await agent.post('/crm/customers').send({ name });
  expect(response.status).toBe(201);
  return response.body.id as string;
}

const KRAFT = '01988a00-0583-7000-8000-000000000001';
const MISSING = '01988a00-0583-7000-8000-00000000ffff';

describe('CRM customer defaults', () => {
  it('reads an account nobody has set up as no defaults at generation 0', async () => {
    const admin = await loginAgent('break-glass', BREAK_GLASS_PASSWORD);
    const customerId = await seedCustomer(admin, 'No Defaults Corp');

    const response = await admin.get(`/crm/customers/${customerId}/defaults`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ customerId, parts: [], lockVersion: 0 });
  });

  it('lets any signed-in user read them', async () => {
    const admin = await loginAgent('break-glass', BREAK_GLASS_PASSWORD);
    const customerId = await seedCustomer(admin, 'Readable Defaults Corp');

    const reader = await loginAgent('dev-production', DEV_PASSWORD);
    expect((await reader.get(`/crm/customers/${customerId}/defaults`)).status).toBe(200);
  });

  it('saves the set, stamps the saver from the session, and reads it back', async () => {
    const admin = await loginAgent('break-glass', BREAK_GLASS_PASSWORD);
    const customerId = await seedCustomer(admin, 'Saved Defaults Corp');

    const saved = await admin.put(`/crm/customers/${customerId}/defaults`).send({
      pricingBasis: 'per_pound',

      tierCode: 'list',
      freightMode: 'carrier',
      leadTimeDays: 10,
      parts: [
        { gradeId: KRAFT, rollWidthIn: 36, partNumber: 'LN-34', description: 'CEDAR CORE' },

        { gradeId: KRAFT, rollWidthIn: 48, partNumber: 'LN-45', feetPerRoll: '1480' },
      ],
      lockVersion: 0,

      updatedBy: 'somebody-else',
    });

    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({
      pricingBasis: 'per_pound',
      tierCode: 'list',
      freightMode: 'carrier',
      leadTimeDays: 10,
      parts: [
        { gradeId: KRAFT, rollWidthIn: 36, partNumber: 'LN-34', description: 'CEDAR CORE' },
        { gradeId: KRAFT, rollWidthIn: 48, partNumber: 'LN-45', feetPerRoll: '1480.0000' },
      ],
      lockVersion: 1,
      updatedBy: 'break-glass',
    });
    const read = await admin.get(`/crm/customers/${customerId}/defaults`);
    expect(read.body).toEqual(saved.body);
  });

  it('refuses a stale generation with 409 stale-aggregate', async () => {
    const admin = await loginAgent('break-glass', BREAK_GLASS_PASSWORD);
    const customerId = await seedCustomer(admin, 'Stale Defaults Corp');
    await admin.put(`/crm/customers/${customerId}/defaults`).send({ lockVersion: 0 });

    const stale = await admin
      .put(`/crm/customers/${customerId}/defaults`)
      .send({ freightMode: 'pickup', lockVersion: 0 });

    expect(stale.status).toBe(409);
    expect(stale.body).toMatchObject({
      reason: 'stale-aggregate',
      value: { expected: 0, actual: 1 },
    });
  });

  it('refuses a malformed body with 400, a repeated paper and width included', async () => {
    const admin = await loginAgent('break-glass', BREAK_GLASS_PASSWORD);
    const customerId = await seedCustomer(admin, 'Bad Defaults Corp');

    const noToken = await admin.put(`/crm/customers/${customerId}/defaults`).send({});
    expect(noToken.status).toBe(400);

    const tierByName = await admin
      .put(`/crm/customers/${customerId}/defaults`)
      .send({ tierCode: 'V2 List', lockVersion: 0 });
    expect(tierByName.status).toBe(400);

    const noLength = await admin.put(`/crm/customers/${customerId}/defaults`).send({
      lockVersion: 0,
      parts: [{ gradeId: KRAFT, rollWidthIn: 36, partNumber: 'A', feetPerRoll: '0' }],
    });
    expect(noLength.status).toBe(400);
    expect(JSON.stringify(noLength.body)).toContain('roll length must be greater than zero');

    const repeated = await admin.put(`/crm/customers/${customerId}/defaults`).send({
      lockVersion: 0,
      parts: [
        { gradeId: KRAFT, rollWidthIn: 36, partNumber: 'A' },
        { gradeId: KRAFT, rollWidthIn: 36, partNumber: 'B' },
      ],
    });
    expect(repeated.status).toBe(400);
  });

  it('saves a part at a width in sixteenths and refuses 13.7 with the width sentence', async () => {
    const admin = await loginAgent('break-glass', BREAK_GLASS_PASSWORD);
    const customerId = await seedCustomer(admin, 'Wrap Parts Corp');

    const saved = await admin.put(`/crm/customers/${customerId}/defaults`).send({
      lockVersion: 0,
      parts: [
        {
          gradeId: KRAFT,
          rollWidthIn: 9.75,
          partNumber: 'MW-20463',
          description: 'CEDAR CORE SHEET',
        },
        { gradeId: KRAFT, rollWidthIn: 12, partNumber: 'P12' },
      ],
    });
    expect(saved.status).toBe(200);
    const read = await admin.get(`/crm/customers/${customerId}/defaults`);
    expect((read.body.parts as { rollWidthIn: number }[]).map((part) => part.rollWidthIn)).toEqual([
      9.75, 12,
    ]);

    const refused = await admin.put(`/crm/customers/${customerId}/defaults`).send({
      lockVersion: saved.body.lockVersion,
      parts: [{ gradeId: KRAFT, rollWidthIn: 13.7, partNumber: 'A' }],
    });
    expect(refused.status).toBe(400);
    expect(JSON.stringify(refused.body)).toContain(
      'a width is whole inches or sixteenths of an inch, from 1 to 1000 (11 5/16 is 11.3125)',
    );
  });

  it('answers 404 for a customer that does not exist, on both routes', async () => {
    const admin = await loginAgent('break-glass', BREAK_GLASS_PASSWORD);
    expect((await admin.get(`/crm/customers/${MISSING}/defaults`)).status).toBe(404);
    expect(
      (await admin.put(`/crm/customers/${MISSING}/defaults`).send({ lockVersion: 0 })).status,
    ).toBe(404);
  });

  it('lets Sales and Billing save', async () => {
    const admin = await loginAgent('break-glass', BREAK_GLASS_PASSWORD);
    const customerId = await seedCustomer(admin, 'Billing Sets The Tier Corp');
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

    const billing = await loginAgent('dev-billing', DEV_PASSWORD);
    const byBilling = await billing
      .put(`/crm/customers/${customerId}/defaults`)
      .send({ tierCode: 'list', lockVersion: 0 });
    expect(byBilling.status).toBe(200);
    expect(byBilling.body).toMatchObject({
      tierCode: 'list',
      lockVersion: 1,
      updatedBy: 'dev-billing',
    });

    const sales = await loginAgent('dev-sales', DEV_PASSWORD);
    const bySales = await sales
      .put(`/crm/customers/${customerId}/defaults`)
      .send({ tierCode: 'list', leadTimeDays: 5, lockVersion: 1 });
    expect(bySales.status).toBe(200);
    expect(bySales.body).toMatchObject({
      tierCode: 'list',
      leadTimeDays: 5,
      lockVersion: 2,
      updatedBy: 'dev-sales',
    });
  });

  it('denies a save to a signed-in user outside the gate', async () => {
    const admin = await loginAgent('break-glass', BREAK_GLASS_PASSWORD);
    const customerId = await seedCustomer(admin, 'Denied Defaults Corp');

    const outsider = await loginAgent('dev-production', DEV_PASSWORD);
    const response = await outsider
      .put(`/crm/customers/${customerId}/defaults`)
      .send({ lockVersion: 0 });

    expect(response.status).toBe(403);
  });
});
