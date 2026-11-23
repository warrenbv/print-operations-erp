// End-to-end over HTTP: the tax code lookup against the fake lookup and the imported rates.
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
process.env.E2E_TAX_CODE_LOOKUP = 'fake';
delete process.env.TAX_CODE_LOOKUP_URL;

let app: INestApplication;

let sales: request.Agent;

let billing: request.Agent;

async function loginAgent(username: string, password: string): Promise<request.Agent> {
  const agent = request.agent(app.getHttpServer());
  const response = await agent.post('/auth/login').send({ username, password });
  expect(response.status).toBe(200);
  return agent;
}

const WAREHOUSE = {
  line1: '200 Sample Road',
  city: 'Sample City',
  postalCode: '99000',
  state: 'WA',
};

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
    ['dev-billing', ['Billing']],
    ['dev-sales', ['Sales']],
  ] as const) {
    const grant = await admin.put(`/admin/users/local:${username}/roles`).send({
      identity: { externalId: `local:${username}`, username, displayName: username },
      roles,
    });
    expect(grant.status).toBe(200);
  }
  billing = await loginAgent('dev-billing', DEV_PASSWORD);
  sales = await loginAgent('dev-sales', DEV_PASSWORD);

  const loaded = await billing.post('/quoting/tax-rates/import').send({
    text: 'WA-9010,0.087,2026-10-01,wa_dor,SAMPLE CITY',
    format: 'erp_rows',
    dryRun: false,
  });
  expect(loaded.status).toBe(200);
  expect((loaded.body as { refused: boolean }).refused).toBe(false);
});

afterAll(async () => {
  await app.close();
  delete process.env.E2E_TAX_CODE_LOOKUP;
});

describe('POST /quoting/tax-code-lookup', () => {
  it('refuses a caller who is not signed in', async () => {
    const response = await request(app.getHttpServer())
      .post('/quoting/tax-code-lookup')
      .send(WAREHOUSE);
    expect(response.status).toBe(401);
  });

  it('fills from our own row for the code the state names', async () => {
    const response = await sales.post('/quoting/tax-code-lookup').send(WAREHOUSE);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      outcome: 'matched',
      locationCode: '9010',
      key: 'WA-9010',
      name: 'SAMPLE CITY',
      effectiveFrom: '2026-10-01',
      stateRate: '0.087',
    });
    expect(Number((response.body as { ourRate: string }).ourRate)).toBe(0.087);
  });

  it('names a code with no loaded rate and fills nothing', async () => {
    const response = await sales
      .post('/quoting/tax-code-lookup')
      .send({ ...WAREHOUSE, line1: '1 Unloaded Code Way' });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      outcome: 'not_loaded',
      locationCode: '9015',
      key: 'WA-9015',
      stateRate: '0.078',
    });
  });

  it('answers a blank street with a sentence, not an error', async () => {
    const response = await sales.post('/quoting/tax-code-lookup').send({ ...WAREHOUSE, line1: '' });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ outcome: 'incomplete_address' });
  });

  it('refuses a body that is not the request', async () => {
    const response = await sales
      .post('/quoting/tax-code-lookup')
      .send({ ...WAREHOUSE, postalCode: '99000-6153-2894' });
    expect(response.status).toBe(400);
  });
});
