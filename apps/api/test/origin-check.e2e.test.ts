// End-to-end over HTTP: a write that carries a browser Origin other than WEB_ORIGIN is refused before anything is read.
// A write with the configured origin or with no Origin at all, and a read from any origin, are handled as before.
// The check is apps/api/src/config/origin-check.ts, applied through apps/api/src/config/request-parsing.ts.
import { request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';

import { DEV_USERNAMES } from '@erp/identity';
import { RECEIVED_DOCUMENT_MAX_BYTES } from '@erp/types';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { applyRequestParsing } from '../src/config/request-parsing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { QuotingStores } from '../src/quoting/quoting.factory';

const DEV_PASSWORD = 'origin-check-password';
const WEB_ORIGIN = 'http://erp.example.test:4100';
const FOREIGN_ORIGINS = [
  'http://elsewhere.example.test',
  'https://erp.example.test:4100',
  'http://erp.example.test:4101',
  'http://erp.example.test',
  'null',
];
const GRADE_ID = 'grade-origin-check';
const BILLING_ADDRESS = {
  line1: '9 Origin Row',
  city: 'Testbury',
  state: 'ID',
  postalCode: '83001',
};
const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(32, 0x20)]);

process.env.NODE_ENV = 'test';
process.env.AUTH_PROVIDER = 'local';
process.env.DATA_PERSISTENCE = 'memory';
process.env.LOCAL_AUTH_PASSWORD = DEV_PASSWORD;
process.env.LOCAL_AUTH_USERS = DEV_USERNAMES.join(',');
process.env.DEV_SEED_ROLES = 'true';
process.env.SESSION_COOKIE_INSECURE = 'true';

let app: INestApplication;
let appWithoutWebOrigin: INestApplication;
let orderId: string;
let rollWidthIn: number;

async function build(webOrigin: string | undefined): Promise<INestApplication> {
  if (webOrigin === undefined) {
    delete process.env.WEB_ORIGIN;
  } else {
    process.env.WEB_ORIGIN = webOrigin;
  }
  const { AuthModule } = await import('../src/auth/auth.module');
  const { CrmModule } = await import('../src/crm/crm.module');
  const { QuotingModule } = await import('../src/quoting/quoting.module');
  const { OrdersModule } = await import('../src/orders/orders.module');
  const { QUOTING_STORES } = await import('../src/quoting/quoting.factory');
  const moduleRef = await Test.createTestingModule({
    imports: [AuthModule, CrmModule, QuotingModule, OrdersModule],
  }).compile();
  const built = moduleRef.createNestApplication();
  applyRequestParsing(built);
  built.use(cookieParser());
  await built.listen(0, '127.0.0.1');

  const stores = moduleRef.get<QuotingStores>(QUOTING_STORES);
  const now = new Date();
  const fits = await stores.palletFits.list('kraft');
  const firstFit = fits[0];
  expect(firstFit).toBeDefined();
  rollWidthIn = firstFit?.rollWidthIn ?? 0;
  await stores.grades.create({
    id: GRADE_ID,
    productFamily: 'kraft',
    code: '41#',
    basisWeightLb: '41.0000',
    reamAreaDivisor: '432.0000',
    paperCostPerTonne: '815.0000',
    footages: [{ variant: 'long', label: 'Long roll', feetPerRoll: '1200.0000' }],
    createdAt: now,
    updatedAt: now,
    widths: fits.map((fit) => ({
      rollWidthIn: fit.rollWidthIn,
      rollsPerPallet: fit.rollsPerPallet,
    })),
  });
  return built;
}

async function signIn(target: INestApplication, username: string): Promise<request.Agent> {
  const agent = request.agent(target.getHttpServer());
  const response = await agent.post('/auth/login').send({ username, password: DEV_PASSWORD });
  expect(response.status).toBe(200);
  return agent;
}

async function newCustomer(agent: request.Agent, name: string): Promise<string> {
  const created = await agent
    .post('/crm/customers')
    .send({ name, billingAddress: BILLING_ADDRESS });
  expect(created.status).toBe(201);
  return created.body.id as string;
}

// A quote priced, given a lead time and sent, then converted, so the order can take a PO document.
async function newOrder(target: INestApplication): Promise<string> {
  const sales = await signIn(target, 'dev-sales');
  const production = await signIn(target, 'dev-production');
  const customerId = await newCustomer(sales, 'Origin Check Order Co');

  const quote = await sales.post('/quoting/quotes').send({ customerId });
  expect(quote.status).toBe(201);
  const quoteId = quote.body.id as string;
  const lockVersion = async (): Promise<number> =>
    (await sales.get(`/quoting/quotes/${quoteId}`)).body.lockVersion as number;

  const lines = await sales.put(`/quoting/quotes/${quoteId}/lines`).send({
    lines: [
      {
        gradeId: GRADE_ID,
        footageVariant: 'long',
        rollWidthIn,
        quantityRolls: 6,
        taxTreatment: { taxStatus: 'id_tax', taxJurisdiction: 'ID' },
      },
    ],
    lockVersion: await lockVersion(),
  });
  expect(lines.status).toBe(200);
  const leadTime = await production
    .put(`/quoting/quotes/${quoteId}/lead-time`)
    .send({ leadTimeDays: 12, lockVersion: await lockVersion() });
  expect(leadTime.status).toBe(200);
  const quoted = await sales
    .post(`/quoting/quotes/${quoteId}/transition`)
    .send({ to: 'quoted', lockVersion: await lockVersion() });
  expect(quoted.status).toBe(200);

  const order = await sales.post('/orders').send({ quoteId });
  expect(order.status).toBe(201);
  return order.body.id as string;
}

async function customerNamed(agent: request.Agent, name: string): Promise<unknown[]> {
  const listed = await agent.get('/crm/customers').query({ q: name });
  expect(listed.status).toBe(200);
  return (listed.body.items as { name: string }[]).filter((item) => item.name === name);
}

async function documentCount(agent: request.Agent): Promise<number> {
  const listed = await agent.get(`/orders/${orderId}/documents`);
  expect(listed.status).toBe(200);
  return (listed.body.documents as unknown[]).length;
}

beforeAll(async () => {
  appWithoutWebOrigin = await build(undefined);
  app = await build(WEB_ORIGIN);
  orderId = await newOrder(app);
});

afterAll(async () => {
  await app.close();
  await appWithoutWebOrigin.close();
  delete process.env.WEB_ORIGIN;
});

const REFUSED = { reason: 'foreign-origin' };

describe('a JSON write with a signed-in session', () => {
  it.each(FOREIGN_ORIGINS)('is refused from %s and creates nothing', async (origin) => {
    const sales = await signIn(app, 'dev-sales');
    const name = `Origin Refused ${origin}`;

    const response = await sales
      .post('/crm/customers')
      .set('Origin', origin)
      .send({ name, billingAddress: BILLING_ADDRESS });

    expect(response.status).toBe(403);
    expect(response.body).toEqual(REFUSED);
    expect(await customerNamed(sales, name)).toEqual([]);
  });

  it('is refused before its body is read, so an oversized body is 403 rather than 413', async () => {
    const sales = await signIn(app, 'dev-sales');

    const response = await sales
      .post('/crm/customers')
      .set('Origin', 'http://elsewhere.example.test')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ name: 'x'.repeat(120 * 1024) }));

    expect(response.status).toBe(403);
    expect(response.body).toEqual(REFUSED);
  });

  it('is handled from the configured origin', async () => {
    const sales = await signIn(app, 'dev-sales');
    const name = 'Origin Allowed Co';

    const response = await sales
      .post('/crm/customers')
      .set('Origin', WEB_ORIGIN)
      .send({ name, billingAddress: BILLING_ADDRESS });

    expect(response.status).toBe(201);
    expect(await customerNamed(sales, name)).toHaveLength(1);
  });

  it('is handled with no Origin, as the web server sends it', async () => {
    const sales = await signIn(app, 'dev-sales');
    const name = 'Origin Absent Co';

    const response = await sales
      .post('/crm/customers')
      .send({ name, billingAddress: BILLING_ADDRESS });

    expect(response.status).toBe(201);
    expect(await customerNamed(sales, name)).toHaveLength(1);
  });

  it('keeps the role refusal for a session without the role, whatever the origin', async () => {
    const billing = await signIn(app, 'dev-billing');

    const response = await billing
      .post('/crm/customers')
      .set('Origin', WEB_ORIGIN)
      .send({ name: 'Origin Wrong Role Co', billingAddress: BILLING_ADDRESS });

    expect(response.status).toBe(403);
    expect(response.body).not.toEqual(REFUSED);
  });
});

describe('a multipart upload with a signed-in session', () => {
  const upload = (agent: request.Agent, bytes: Buffer): request.Test =>
    agent
      .post(`/orders/${orderId}/purchase-order/document`)
      .attach('file', bytes, { filename: 'po-origin.pdf', contentType: 'application/pdf' });

  it('is refused from another origin and stores nothing', async () => {
    const sales = await signIn(app, 'dev-sales');
    const before = await documentCount(sales);

    const response = await upload(sales, PDF).set('Origin', 'http://elsewhere.example.test');

    expect(response.status).toBe(403);
    expect(response.body).toEqual(REFUSED);
    expect(await documentCount(sales)).toBe(before);
  });

  // The body is held back after its first bytes. A reply that arrives anyway was given without reading the file.
  it('is answered before the file is read', async () => {
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ username: 'dev-sales', password: DEV_PASSWORD });
    const cookie = (login.headers['set-cookie'] as unknown as string[])[0]?.split(';')[0] ?? '';
    const { port } = app.getHttpServer().address() as AddressInfo;
    const boundary = 'origin-check-boundary';

    const reply = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      const pending = httpRequest(
        {
          host: '127.0.0.1',
          port,
          method: 'POST',
          path: `/orders/${orderId}/purchase-order/document`,
          headers: {
            Cookie: cookie,
            Origin: 'http://elsewhere.example.test',
            'Content-Type': `multipart/form-data; boundary=${boundary}`,
            'Content-Length': String(RECEIVED_DOCUMENT_MAX_BYTES + 1),
          },
        },
        (response) => {
          let body = '';
          response.setEncoding('utf8');
          response.on('data', (chunk: string) => (body += chunk));
          response.on('end', () => {
            pending.destroy();
            resolve({ status: response.statusCode ?? 0, body });
          });
        },
      );
      pending.on('error', reject);
      pending.write(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="po-origin.pdf"\r\n` +
          'Content-Type: application/pdf\r\n\r\n%PDF-1.7\n',
      );
    });

    expect(reply.status).toBe(403);
    expect(JSON.parse(reply.body)).toEqual(REFUSED);
  });

  it('is stored from the configured origin', async () => {
    const sales = await signIn(app, 'dev-sales');
    const before = await documentCount(sales);

    const response = await upload(sales, PDF).set('Origin', WEB_ORIGIN);

    expect(response.status).toBe(201);
    expect(await documentCount(sales)).toBe(before + 1);
  });

  it('is stored with no Origin', async () => {
    const sales = await signIn(app, 'dev-sales');
    const before = await documentCount(sales);

    const response = await upload(sales, PDF);

    expect(response.status).toBe(201);
    expect(await documentCount(sales)).toBe(before + 1);
  });
});

describe('sign-out', () => {
  it('is refused from another origin and the session stays signed in', async () => {
    const sales = await signIn(app, 'dev-sales');

    const response = await sales
      .post('/auth/logout')
      .set('Origin', 'http://elsewhere.example.test');

    expect(response.status).toBe(403);
    expect(response.body).toEqual(REFUSED);
    expect(response.headers['set-cookie']).toBeUndefined();
    expect((await sales.get('/auth/me')).status).toBe(200);
  });

  it('ends the session from the configured origin', async () => {
    const sales = await signIn(app, 'dev-sales');

    expect((await sales.post('/auth/logout').set('Origin', WEB_ORIGIN)).status).toBe(204);
    expect((await sales.get('/auth/me')).status).toBe(401);
  });

  it('ends the session with no Origin', async () => {
    const sales = await signIn(app, 'dev-sales');

    expect((await sales.post('/auth/logout')).status).toBe(204);
    expect((await sales.get('/auth/me')).status).toBe(401);
  });
});

describe('sign-in', () => {
  it('is refused from another origin and sets no session cookie', async () => {
    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .set('Origin', 'http://elsewhere.example.test')
      .send({ username: 'dev-sales', password: DEV_PASSWORD });

    expect(response.status).toBe(403);
    expect(response.body).toEqual(REFUSED);
    expect(response.headers['set-cookie']).toBeUndefined();
  });

  it('signs in from the configured origin', async () => {
    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .set('Origin', WEB_ORIGIN)
      .send({ username: 'dev-sales', password: DEV_PASSWORD });

    expect(response.status).toBe(200);
  });
});

describe('a read', () => {
  it('is unaffected by another origin', async () => {
    const sales = await signIn(app, 'dev-sales');

    const listed = await sales.get('/crm/customers').set('Origin', 'http://elsewhere.example.test');
    const document = await sales
      .get(`/orders/${orderId}/documents`)
      .set('Origin', 'http://elsewhere.example.test');
    const head = await sales.head('/auth/me').set('Origin', 'http://elsewhere.example.test');

    expect(listed.status).toBe(200);
    expect(document.status).toBe(200);
    expect(head.status).toBe(200);
  });
});

describe('with WEB_ORIGIN unset', () => {
  it('refuses a write that carries any Origin', async () => {
    const sales = await signIn(appWithoutWebOrigin, 'dev-sales');

    for (const origin of [WEB_ORIGIN, 'http://elsewhere.example.test']) {
      const response = await sales
        .post('/crm/customers')
        .set('Origin', origin)
        .send({ name: `Unset Origin ${origin}`, billingAddress: BILLING_ADDRESS });

      expect(response.status, origin).toBe(403);
      expect(response.body, origin).toEqual(REFUSED);
    }
  });

  it('refuses a sign-in that carries an Origin', async () => {
    const response = await request(appWithoutWebOrigin.getHttpServer())
      .post('/auth/login')
      .set('Origin', WEB_ORIGIN)
      .send({ username: 'dev-sales', password: DEV_PASSWORD });

    expect(response.status).toBe(403);
    expect(response.body).toEqual(REFUSED);
  });

  it('handles a write with no Origin', async () => {
    const sales = await signIn(appWithoutWebOrigin, 'dev-sales');

    const response = await sales
      .post('/crm/customers')
      .send({ name: 'Unset Origin Absent Co', billingAddress: BILLING_ADDRESS });

    expect(response.status).toBe(201);
  });
});
