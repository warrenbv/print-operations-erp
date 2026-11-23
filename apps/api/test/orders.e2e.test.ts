// End-to-end over HTTP: converting a quote, the PO, confirmation, the confirmation document, the listings and the role gates.
import { DEV_USERNAMES } from '@erp/identity';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { applyRequestParsing } from '../src/config/request-parsing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { newId } from '@erp/db';
import type { OrderService } from '@erp/orders';
import {
  MAIL_CONTACT_ROLES,
  perPoundProductPrice,
  quoteReference,
  roundToCents,
  toDecimal,
  toMeasure,
  toMoney,
} from '@erp/types';
import { IDENTITY_STORES } from '../src/auth/auth.factory';
import type { QuotingStores } from '../src/quoting/quoting.factory';

const QUOTABLE_BILLING_ADDRESS = {
  line1: '1 Test Way',
  city: 'Demo Falls',
  state: 'ID',
  postalCode: '83010',
};

const DEV_PASSWORD = 'dev-password';
const BREAK_GLASS_PASSWORD = 'sealed-emergency-password';

process.env.NODE_ENV = 'test';
process.env.AUTH_PROVIDER = 'local';
process.env.DATA_PERSISTENCE = 'memory';
process.env.LOCAL_AUTH_PASSWORD = DEV_PASSWORD;
process.env.LOCAL_AUTH_USERS = DEV_USERNAMES.join(',');
process.env.BREAK_GLASS_DEV_PASSWORD = BREAK_GLASS_PASSWORD;
process.env.SESSION_COOKIE_INSECURE = 'true';

const WEB_BASE_URL = 'https://erp.example.test';
process.env.WEB_BASE_URL = WEB_BASE_URL;

const KRAFT_37_ID = 'grade-kraft-37';

let app: INestApplication;
let mailSink: import('@erp/notifications').InMemoryMailSink;
let sendLog: import('@erp/notifications').InMemorySendLog;
let sales: request.Agent;
let production: request.Agent;
let productionManager: request.Agent;

let noroles: request.Agent;

let admin: request.Agent;
let orderService: OrderService;
let quotingStores: QuotingStores;

let customerA: string;
let customerB: string;
let orderA1: string;
let orderA2: string;
let orderB1: string;

async function loginAgent(username: string, password: string): Promise<request.Agent> {
  const agent = request.agent(app.getHttpServer());
  const response = await agent.post('/auth/login').send({ username, password });
  expect(response.status).toBe(200);
  return agent;
}

function http(): request.Agent {
  return request(app.getHttpServer());
}

const PDF_BYTES = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(64)]);

async function lockVersionOf(orderId: string): Promise<number> {
  return (await sales.get(`/orders/${orderId}`)).body.lockVersion as number;
}

async function uploadPo(
  agent: request.Agent,
  orderId: string,
  bytes: Buffer,
  filename: string,
  contentType: string,
): Promise<request.Response> {
  return agent
    .post(`/orders/${orderId}/purchase-order/document`)
    .attach('file', bytes, { filename, contentType });
}

async function fileFullPurchaseOrder(
  orderId: string,
  po: {
    poNumber: string;
    lines: { lineNumber: number; paper: string; poundage: string; rolls: number }[];
  },
): Promise<void> {
  const attached = await uploadPo(
    sales,
    orderId,
    PDF_BYTES,
    `${po.poNumber}.pdf`,
    'application/pdf',
  );
  expect(attached.status).toBe(201);
  const captured = await sales
    .put(`/orders/${orderId}/purchase-order`)
    .send({ ...po, lockVersion: await lockVersionOf(orderId) });
  expect(captured.status).toBe(200);
}

const plainLine = {
  gradeId: KRAFT_37_ID,
  footageVariant: 'long',
  rollWidthIn: 12,
  quantityRolls: 10,

  taxTreatment: { taxStatus: 'id_tax', taxJurisdiction: 'ID' },
};

async function createQuote(customerId?: string, salesRep?: string): Promise<string> {
  const created = await sales
    .post('/quoting/quotes')
    .send({ customerId: customerId ?? customerA, ...(salesRep === undefined ? {} : { salesRep }) });
  expect(created.status).toBe(201);
  return created.body.id as string;
}

async function putLines(
  quoteId: string,
  lines: unknown[] = [plainLine],
): Promise<request.Response> {
  return sales
    .put(`/quoting/quotes/${quoteId}/lines`)
    .send({ lines, lockVersion: await quoteLockVersion(quoteId) });
}

async function send(quoteId: string): Promise<request.Response> {
  await setQuoteLeadTime(quoteId);
  return sales
    .post(`/quoting/quotes/${quoteId}/transition`)
    .send({ to: 'quoted', lockVersion: await quoteLockVersion(quoteId) });
}

async function quotedQuote(
  customerId: string,
  lines?: unknown[],

  salesRep?: string,
): Promise<string> {
  const quoteId = await createQuote(customerId, salesRep);
  expect((await putLines(quoteId, lines)).status).toBe(200);
  expect((await send(quoteId)).status).toBe(200);
  return quoteId;
}

beforeAll(async () => {
  const { AuthModule } = await import('../src/auth/auth.module');
  const { AdminModule } = await import('../src/admin/admin.module');
  const { CrmModule } = await import('../src/crm/crm.module');
  const { QuotingModule } = await import('../src/quoting/quoting.module');
  const { OrdersModule } = await import('../src/orders/orders.module');
  const { QUOTING_STORES } = await import('../src/quoting/quoting.factory');
  const { OrderService: OrderServiceToken } = await import('@erp/orders');

  const { MAIL_SINK, SEND_LOG } = await import('../src/notifications/notifications.factory');
  const { InMemoryMailSink, InMemorySendLog, systemClock } = await import('@erp/notifications');
  mailSink = new InMemoryMailSink(systemClock);

  sendLog = new InMemorySendLog();

  const moduleRef = await Test.createTestingModule({
    imports: [AuthModule, AdminModule, CrmModule, QuotingModule, OrdersModule],
  })
    .overrideProvider(MAIL_SINK)
    .useValue(mailSink)
    .overrideProvider(SEND_LOG)
    .useValue(sendLog)
    .compile();
  app = moduleRef.createNestApplication();
  applyRequestParsing(app);
  app.use(cookieParser());
  await app.listen(0, '127.0.0.1');

  const stores = moduleRef.get<QuotingStores>(QUOTING_STORES);
  quotingStores = stores;

  await stores.taxRates.importRates([
    {
      jurisdiction: 'WA-9034',
      rate: '0.092700',
      effectiveFrom: '2026-10-01',
      source: 'wa_dor',
      name: 'SAMPLE CITY',
    },
  ]);
  const now = new Date();
  await stores.grades.create({
    id: KRAFT_37_ID,
    productFamily: 'kraft',
    code: '37#',
    basisWeightLb: '37.0000',
    reamAreaDivisor: '432.0000',
    paperCostPerTonne: '900.0000',
    footages: [
      { variant: 'long', label: 'Long roll', feetPerRoll: '1000.0000' },
      { variant: 'short', label: 'Short roll', feetPerRoll: '765.0000' },
    ],
    createdAt: now,
    updatedAt: now,

    widths: (await stores.palletFits.list('kraft')).map(({ rollWidthIn, rollsPerPallet }) => ({
      rollWidthIn,
      rollsPerPallet,
    })),
  });

  sales = await loginAgent('dev-sales', DEV_PASSWORD);
  production = await loginAgent('dev-production', DEV_PASSWORD);
  productionManager = await loginAgent('dev-production-manager', DEV_PASSWORD);
  noroles = await loginAgent('dev-noroles', DEV_PASSWORD);

  admin = await loginAgent('break-glass', BREAK_GLASS_PASSWORD);
  for (const [username, roles] of [
    ['dev-sales', ['Sales']],

    ['dev-production', ['Production']],

    ['dev-production-manager', ['ProductionManager']],

    ['dev-billing', ['Billing']],
  ] as const) {
    const grant = await admin.put(`/admin/users/local:${username}/roles`).send({
      identity: { externalId: `local:${username}`, username, displayName: username },
      roles,
    });
    expect(grant.status).toBe(200);
  }

  const a = await sales.post('/crm/customers').send({
    billingAddress: QUOTABLE_BILLING_ADDRESS,
    name: 'Orders E2E Alpha Co',
    legacyAccountNumber: 'LA-O-A',
  });
  expect(a.status).toBe(201);
  customerA = a.body.id;
  const b = await sales.post('/crm/customers').send({
    billingAddress: QUOTABLE_BILLING_ADDRESS,
    name: 'Orders E2E Beta Co',
    legacyAccountNumber: 'LA-O-B',
  });
  expect(b.status).toBe(201);
  customerB = b.body.id;

  orderService = moduleRef.get(OrderServiceToken);
  orderA1 = await convert(await quotedQuote(customerA));
  orderA2 = await convert(await quotedQuote(customerA));
  orderB1 = await convert(await quotedQuote(customerB));
});

async function convert(quoteId: string): Promise<string> {
  const created = await sales.post('/orders').send({ quoteId });
  expect(created.status).toBe(201);
  return created.body.id as string;
}

afterAll(async () => {
  await app.close();
});

async function quoteLockVersion(quoteId: string): Promise<number> {
  const current = await sales.get(`/quoting/quotes/${quoteId}`);
  expect(current.status).toBe(200);
  return current.body.lockVersion as number;
}

async function setQuoteLeadTime(quoteId: string, leadTimeDays = 10): Promise<void> {
  const current = await sales.get(`/quoting/quotes/${quoteId}`);
  expect(current.status).toBe(200);
  const response = await production
    .put(`/quoting/quotes/${quoteId}/lead-time`)
    .send({ leadTimeDays, lockVersion: current.body.lockVersion as number });
  expect(response.status).toBe(200);
}

describe('Orders edge — authentication and authorization', () => {
  it('rejects an anonymous request on every route (SessionGuard)', async () => {
    expect((await http().get('/orders')).status).toBe(401);
    expect((await http().get('/orders/totals').query({ ids: 'x' })).status).toBe(401);
    expect((await http().get('/orders/00000000-0000-4000-8000-000000000000')).status).toBe(401);
    expect((await http().get('/orders/00000000-0000-4000-8000-000000000000/totals')).status).toBe(
      401,
    );
    expect(
      (await http().get('/orders/00000000-0000-4000-8000-000000000000/transitions')).status,
    ).toBe(401);
    expect((await http().post('/orders').send({ quoteId: 'x' })).status).toBe(401);
  });

  it('lets any signed-in user read, including one with no roles', async () => {
    const response = await noroles.get('/orders').query({ customerId: customerA });
    expect(response.status).toBe(200);
  });

  it('lets any signed-in user convert — intake begins here and the mail-opener may not be Sales', async () => {
    const own = await sales.post('/crm/customers').send({
      billingAddress: QUOTABLE_BILLING_ADDRESS,
      name: 'Orders E2E Gate Co',
      legacyAccountNumber: 'LA-O-GATE',
    });
    expect(own.status).toBe(201);

    const response = await noroles
      .post('/orders')
      .send({ quoteId: await quotedQuote(own.body.id as string) });
    expect(response.status).toBe(201);
  });
});

describe('Orders edge — listing', () => {
  it('filters to one customer, newest first, carrying what the profile joins on', async () => {
    const response = await sales.get('/orders').query({ customerId: customerA });
    expect(response.status).toBe(200);
    const items = response.body.items as {
      id: string;
      quoteId: string;
      customerId: string;
      status: string;
      createdAt: string;
    }[];
    expect(items.map((o) => o.id).sort()).toEqual([orderA1, orderA2].sort());
    for (const item of items) {
      expect(item.customerId).toBe(customerA);

      expect(typeof item.status).toBe('string');
      expect(typeof item.createdAt).toBe('string');
    }
    const stamps = items.map((o) => o.createdAt);
    expect([...stamps].sort().reverse()).toEqual(stamps);
  });

  it('answers the whole book with no filter', async () => {
    const response = await sales.get('/orders');
    expect(response.status).toBe(200);
    const ids = (response.body.items as { id: string }[]).map((o) => o.id);

    expect(ids).toEqual(expect.arrayContaining([orderA1, orderA2, orderB1]));

    const filtered = await sales.get('/orders').query({ customerId: customerB });
    expect(ids.length).toBeGreaterThan((filtered.body.items as unknown[]).length);
  });

  it('filters by status once an order moves', async () => {
    await fileFullPurchaseOrder(orderA1, {
      poNumber: 'PO-A1',
      lines: [{ lineNumber: 1, paper: 'kraft', poundage: '37.0000', rolls: 10 }],
    });

    const moved = await orderService.transition(
      orderA1,
      { to: 'confirmed' },
      { actor: 'dev-pm', confirmedLeadTimeDays: 14 },
    );
    expect(moved?.status).toBe('confirmed');

    const confirmed = await sales.get('/orders').query({ status: 'confirmed' });
    expect((confirmed.body.items as { id: string }[]).map((o) => o.id)).toEqual([orderA1]);

    const combined = await sales
      .get('/orders')
      .query({ customerId: customerA, status: 'converted' });
    expect((combined.body.items as { id: string }[]).map((o) => o.id)).toEqual([orderA2]);
  });

  it('takes a repeated status and returns the union', async () => {
    const both = await sales.get(
      `/orders?customerId=${customerA}&status=confirmed&status=converted`,
    );
    expect(both.status).toBe(200);
    expect((both.body.items as { id: string }[]).map((o) => o.id).sort()).toEqual(
      [orderA1, orderA2].sort(),
    );

    const repeated = await sales.get(
      `/orders?customerId=${customerA}&status=confirmed&status=confirmed`,
    );
    expect((repeated.body.items as { id: string }[]).map((o) => o.id)).toEqual([orderA1]);

    const one = await sales.get(`/orders?customerId=${customerA}&status=converted`);
    expect((one.body.items as { id: string }[]).map((o) => o.id)).toEqual([orderA2]);
  });

  it('filters by sales rep, exactly, and composes with the other filters', async () => {
    const own = await sales.post('/crm/customers').send({
      billingAddress: QUOTABLE_BILLING_ADDRESS,
      name: 'Orders E2E Rep Filter Co',
      legacyAccountNumber: 'LA-O-REPFILTER',
    });
    expect(own.status).toBe(201);
    const customerId = own.body.id as string;

    const janes = await sales
      .post('/orders')
      .send({ quoteId: await quotedQuote(customerId, undefined, 'jsmith') });
    expect(janes.status).toBe(201);
    const rowans = await sales
      .post('/orders')
      .send({ quoteId: await quotedQuote(customerId, undefined, 'rlee') });
    expect(rowans.status).toBe(201);

    const filtered = await sales.get(`/orders?customerId=${customerId}&salesRep=jsmith`);
    expect(filtered.status).toBe(200);
    expect((filtered.body.items as { id: string }[]).map((o) => o.id)).toEqual([
      janes.body.id as string,
    ]);

    const prefix = await sales.get(`/orders?customerId=${customerId}&salesRep=jsmit`);
    expect(prefix.body.items).toEqual([]);

    const withStatus = await sales.get(
      `/orders?customerId=${customerId}&salesRep=jsmith&status=confirmed`,
    );
    expect(withStatus.body.items).toEqual([]);
  });

  it('400s an empty or repeated salesRep rather than reading it as no filter', async () => {
    expect((await sales.get('/orders?salesRep=')).status).toBe(400);
    expect((await sales.get('/orders?salesRep=%20')).status).toBe(400);
    expect((await sales.get('/orders?salesRep=jsmith&salesRep=rlee')).status).toBe(400);
  });

  it('400s an empty or unknown status rather than reading it as no filter', async () => {
    expect((await sales.get('/orders?status=')).status).toBe(400);
    expect((await sales.get('/orders?status=confirmed&status=')).status).toBe(400);
    expect((await sales.get('/orders?status=not_a_status')).status).toBe(400);
    expect((await sales.get('/orders?status=confirmed&status=not_a_status')).status).toBe(400);
  });

  it('filters to the order a quote became, and is empty when it has not', async () => {
    const quoteId = await quotedQuote(customerB);
    const orderId = await convert(quoteId);

    const converted = await sales.get('/orders').query({ quoteId });
    expect(converted.status).toBe(200);
    expect((converted.body.items as { id: string }[]).map((o) => o.id)).toEqual([orderId]);

    const unconverted = await sales.get('/orders').query({ quoteId: await quotedQuote(customerB) });
    expect(unconverted.status).toBe(200);
    expect(unconverted.body.items).toEqual([]);
  });

  it('carries each line delivery address from the quote onto the order', async () => {
    const harbor = {
      name: 'Harbor Receiving',
      line1: '200 Example Way',
      line2: 'Dock 3',
      city: 'Sample Harbor',
      state: 'WA',
      postalCode: '98000-6153',
    };
    const falls = {
      line1: '500 Example Way',
      city: 'Demo Falls',
      state: 'ID',
      postalCode: '83010',
    };

    const quoteId = await createQuote(customerB);

    const priced = await sales.put(`/quoting/quotes/${quoteId}/lines`).send({
      lockVersion: await quoteLockVersion(quoteId),
      lines: [
        {
          ...plainLine,

          taxTreatment: { taxStatus: 'wa_tax', taxJurisdiction: 'WA-9034' },
          deliveryAddress: harbor,
        },
        { ...plainLine, deliveryAddress: falls },
      ],
    });
    expect(priced.status).toBe(200);
    expect(
      (priced.body.lines as { deliveryAddress?: unknown }[]).map((l) => l.deliveryAddress),
    ).toEqual([harbor, falls]);

    expect((await send(quoteId)).status).toBe(200);
    const orderId = await convert(quoteId);

    const order = await sales.get(`/orders/${orderId}`);
    expect(order.status).toBe(200);
    expect(
      (order.body.lines as { deliveryAddress?: unknown }[]).map((l) => l.deliveryAddress),
    ).toEqual([harbor, falls]);
  });

  it('leaves the address off an order whose quote carried none', async () => {
    const orderId = await convert(await quotedQuote(customerB));

    const order = await sales.get(`/orders/${orderId}`);
    expect(order.status).toBe(200);
    expect(order.body.lines[0]).not.toHaveProperty('deliveryAddress');
  });

  it('composes the quote filter with the others rather than ignoring them', async () => {
    const quoteId = await quotedQuote(customerB);
    const orderId = await convert(quoteId);

    expect((await sales.get('/orders').query({ quoteId, status: 'converted' })).body.items).toEqual(
      [expect.objectContaining({ id: orderId })],
    );
    expect((await sales.get('/orders').query({ quoteId, status: 'confirmed' })).body.items).toEqual(
      [],
    );
    expect(
      (await sales.get('/orders').query({ quoteId, customerId: customerB })).body.items,
    ).toEqual([expect.objectContaining({ id: orderId })]);
    expect(
      (await sales.get('/orders').query({ quoteId, customerId: 'someone-else' })).body.items,
    ).toEqual([]);
  });

  it('filters by the customer PO number, and is empty for one never sent', async () => {
    const orderId = await convert(await quotedQuote(customerB));
    await fileFullPurchaseOrder(orderId, {
      poNumber: 'PO-PREFLIGHT-1',
      lines: [{ lineNumber: 1, paper: 'kraft', poundage: '37.0000', rolls: 10 }],
    });

    const used = await sales
      .get('/orders')
      .query({ customerId: customerB, poNumber: 'PO-PREFLIGHT-1' });
    expect(used.status).toBe(200);
    expect((used.body.items as { id: string }[]).map((o) => o.id)).toEqual([orderId]);

    const free = await sales
      .get('/orders')
      .query({ customerId: customerB, poNumber: 'PO-NEVER-SENT' });
    expect(free.body.items).toEqual([]);

    const otherCustomer = await sales
      .get('/orders')
      .query({ customerId: customerA, poNumber: 'PO-PREFLIGHT-1' });
    expect(otherCustomer.body.items).toEqual([]);
  });

  it('400s malformed filters rather than silently matching nothing', async () => {
    expect((await sales.get('/orders').query({ customerId: '' })).status).toBe(400);
    expect((await sales.get('/orders').query({ status: 'shipped' })).status).toBe(400);

    expect((await sales.get('/orders?customerId=a&customerId=b')).status).toBe(400);

    const empty = await sales.get('/orders').query({ quoteId: '' });
    expect(empty.status).toBe(400);
    expect(empty.body.reason).toBe('empty-quote-id');
    const emptyAmong = await sales.get(`/orders?quoteId=${newId()}&quoteId=`);
    expect(emptyAmong.status).toBe(400);
    expect(emptyAmong.body.reason).toBe('empty-quote-id');

    const tooMany = Array.from({ length: 101 }, () => `quoteId=${newId()}`).join('&');
    const overCeiling = await sales.get(`/orders?${tooMany}`);
    expect(overCeiling.status).toBe(400);
    expect(overCeiling.body.reason).toBe('invalid-quote-id');

    expect((await sales.get('/orders').query({ poNumber: '' })).status).toBe(400);
    expect((await sales.get('/orders?poNumber=a&poNumber=b')).status).toBe(400);
  });
});

describe('Orders edge — conversion', () => {
  it('creates the order with its lines, copied at the figures the quote was sent at', async () => {
    const quoteId = await quotedQuote(customerA);
    const quote = await sales.get(`/quoting/quotes/${quoteId}`);
    expect(quote.status).toBe(200);
    const quoteLine = quote.body.lines[0];

    const created = await sales.post('/orders').send({ quoteId });
    expect(created.status).toBe(201);
    expect(created.body.status).toBe('converted');
    expect(created.body.customerId).toBe(customerA);

    expect(created.body.lines).toHaveLength(1);
    const orderLine = created.body.lines[0];
    expect(orderLine.quoteLineId).toBe(quoteLine.id);
    expect(orderLine.orderId).toBe(created.body.id);
    expect(orderLine.lineNumber).toBe(quoteLine.lineNumber);

    expect(orderLine.gradeId).toBe(quoteLine.gradeId);
    expect(orderLine.quantityRolls).toBe(quoteLine.quantityRolls);

    expect(orderLine.feetPerRoll).toBe(quoteLine.cost.feetPerRoll);
    expect(orderLine.pricePerRoll).toBe(quoteLine.pricePerRoll);
    expect(orderLine.extendedPrice).toBe(quoteLine.extendedPrice);
    expect(orderLine.extendedCost).toBe(quoteLine.extendedCost);
    expect(orderLine.extendedMargin).toBe(quoteLine.extendedMargin);
    expect(orderLine.estimatedWeightLb).toBe(quoteLine.estimatedWeightLb);
    expect(orderLine.freightResult).toEqual(quoteLine.freightResult);
    expect(orderLine.freight).toEqual(quoteLine.freight);

    expect(orderLine).not.toHaveProperty('cost');
    expect(orderLine).not.toHaveProperty('tier');
  });

  it('carries the sales rep from the quote onto the order', async () => {
    const quoteId = await quotedQuote(customerA, undefined, 'jsmith');

    const created = await sales.post('/orders').send({ quoteId });
    expect(created.status).toBe(201);
    expect(created.body.salesRep).toBe('jsmith');

    const read = await sales.get(`/orders/${created.body.id as string}`);
    expect(read.body.salesRep).toBe('jsmith');
  });

  it('ignores a sales rep in the request body', async () => {
    const quoteId = await quotedQuote(customerA, undefined, 'jsmith');

    const created = await sales.post('/orders').send({ quoteId, salesRep: 'somebody-else' });
    expect(created.status).toBe(201);
    expect(created.body.salesRep).toBe('jsmith');
  });

  it('leaves the rep off an order whose quote named nobody', async () => {
    const quoteId = await quotedQuote(customerA);

    const created = await sales.post('/orders').send({ quoteId });
    expect(created.status).toBe(201);
    expect(created.body).not.toHaveProperty('salesRep');
  });

  it('creates the order holding the delivery date sent with the conversion', async () => {
    const quoteId = await quotedQuote(customerA);

    const created = await sales.post('/orders').send({ quoteId, requestedDate: '2027-06-10' });
    expect(created.status).toBe(201);
    expect(created.body.requestedDate).toBe('2027-06-10');

    const read = await sales.get(`/orders/${created.body.id as string}`);
    expect(read.body.requestedDate).toBe('2027-06-10');
  });

  it('400s a delivery date that is not a calendar date, and makes no order', async () => {
    const quoteId = await quotedQuote(customerA);

    const refused = await sales
      .post('/orders')
      .send({ quoteId, requestedDate: '2027-06-10T00:00:00Z' });
    expect(refused.status).toBe(400);

    const orders = await sales.get('/orders').query({ quoteId });
    expect(orders.status).toBe(200);
    expect(orders.body.items).toHaveLength(0);
  });

  it('leaves the quote alone — conversion is not a quote transition', async () => {
    const quoteId = await quotedQuote(customerA);
    await sales.post('/orders').send({ quoteId });

    const after = await sales.get(`/quoting/quotes/${quoteId}`);
    expect(after.body.status).toBe('quoted');
  });

  it('refuses to close a converted quote as lost, and leaves it quoted', async () => {
    const quoteId = await quotedQuote(customerB);
    expect((await sales.post('/orders').send({ quoteId })).status).toBe(201);

    const refused = await sales
      .post(`/quoting/quotes/${quoteId}/transition`)
      .send({ to: 'closed_lost', lockVersion: await quoteLockVersion(quoteId) });
    expect(refused.status).toBe(409);
    expect(refused.body.reason).toBe('quote-has-order');
    expect(refused.body.value).toBe(quoteId);

    expect((await sales.get(`/quoting/quotes/${quoteId}`)).body.status).toBe('quoted');
  });

  it('still lets an unconverted sent quote be closed as lost', async () => {
    const quoteId = await quotedQuote(customerB);

    const closed = await sales
      .post(`/quoting/quotes/${quoteId}/transition`)
      .send({ to: 'closed_lost', lockVersion: await quoteLockVersion(quoteId) });
    expect(closed.status).toBe(200);
    expect(closed.body.status).toBe('closed_lost');
  });

  it('converts a quote a second time, at the same prices', async () => {
    const quoteId = await quotedQuote(customerA);
    const first = await sales.post('/orders').send({ quoteId });
    expect(first.status).toBe(201);

    const second = await sales.post('/orders').send({ quoteId });
    expect(second.status).toBe(201);
    expect(second.body.id).not.toBe(first.body.id);

    expect(second.body.lines.map((line: { pricePerRoll: string }) => line.pricePerRoll)).toEqual(
      first.body.lines.map((line: { pricePerRoll: string }) => line.pricePerRoll),
    );

    const listed = await sales.get(`/orders?quoteId=${quoteId}`);
    expect(listed.status).toBe(200);
    expect(listed.body.items.map((order: { id: string }) => order.id).sort()).toEqual(
      [first.body.id, second.body.id].sort(),
    );
  });

  it('lists the orders of several quotes, counts them, and sorts them by age', async () => {
    const quoteA = await quotedQuote(customerA);
    const quoteB = await quotedQuote(customerA);
    const fromA = await sales.post('/orders').send({ quoteId: quoteA });
    const fromB = await sales.post('/orders').send({ quoteId: quoteB });
    expect(fromA.status).toBe(201);
    expect(fromB.status).toBe(201);
    const both = `quoteId=${quoteA}&quoteId=${quoteB}`;

    const listed = await sales.get(`/orders?${both}`);
    expect(listed.status).toBe(200);
    expect(listed.body.items.map((order: { id: string }) => order.id).sort()).toEqual(
      [fromA.body.id, fromB.body.id].sort(),
    );

    const counted = await sales.get(`/orders?${both}&count=true`);
    expect(counted.status).toBe(200);
    expect(counted.body).not.toHaveProperty('items');
    expect(counted.body.count).toBe(2);
    expect(counted.body.oldest.id).toBe(fromA.body.id);
    expect(Object.keys(counted.body.oldest).sort()).toEqual(
      ['customerId', 'id', 'quoteId', 'status', 'updatedAt'].sort(),
    );
    expect((await sales.get(`/orders?quoteId=${newId()}&count=true`)).body).toEqual({
      count: 0,
      oldest: null,
    });

    const oldestFirst = await sales.get(`/orders?${both}&sort=oldest&limit=1`);
    expect(oldestFirst.body.items.map((order: { id: string }) => order.id)).toEqual([
      fromA.body.id,
    ]);
    const newestFirst = await sales.get(`/orders?${both}&sort=newest`);
    expect(newestFirst.body.items.map((order: { id: string }) => order.id)).toEqual([
      fromB.body.id,
      fromA.body.id,
    ]);
  });

  it('lists, counts and cuts the quotes no order was converted from', async () => {
    const converted = await quotedQuote(customerB);
    const open = await quotedQuote(customerB);
    await convert(converted);
    const filters = `status=quoted&customerId=${customerB}&converted=false`;

    const listed = await sales.get(`/quoting/quotes?${filters}`);
    expect(listed.status).toBe(200);
    const ids = listed.body.items.map((quote: { id: string }) => quote.id);
    expect(ids).toContain(open);
    expect(ids).not.toContain(converted);

    const all = await sales.get(`/quoting/quotes?status=quoted&customerId=${customerB}`);
    expect(all.body.items.map((quote: { id: string }) => quote.id)).toContain(converted);

    const counted = await sales.get(`/quoting/quotes?${filters}&count=true`);
    expect(counted.status).toBe(200);
    expect(counted.body.count).toBe(ids.length);
    const oldestFirst = await sales.get(`/quoting/quotes?${filters}&sort=oldest&limit=1`);
    expect(oldestFirst.body.items).toHaveLength(1);
    expect(counted.body.oldest.id).toBe(oldestFirst.body.items[0].id);
  });

  it('400s a converted filter other than false', async () => {
    for (const value of ['true', '', 'no']) {
      const refused = await sales.get(`/quoting/quotes?converted=${value}`);
      expect(refused.status, value).toBe(400);
      expect(refused.body.reason).toBe('invalid-converted-filter');
    }
    const repeated = await sales.get('/quoting/quotes?converted=false&converted=false');
    expect(repeated.status).toBe(400);
  });

  it('400s a count, limit or sort it cannot read', async () => {
    const cases: [Record<string, string>, string][] = [
      [{ count: 'yes' }, 'invalid-count'],
      [{ count: 'true', limit: '5' }, 'invalid-count-query'],
      [{ count: 'true', sort: 'newest' }, 'invalid-count-query'],
      [{ limit: '0' }, 'invalid-limit'],
      [{ limit: '201' }, 'invalid-limit'],
      [{ sort: 'created' }, 'invalid-sort'],
    ];
    for (const [query, reason] of cases) {
      const response = await sales.get('/orders').query(query);
      expect(response.status, JSON.stringify(query)).toBe(400);
      expect(response.body.reason, JSON.stringify(query)).toBe(reason);
    }
  });

  it('422s a quote that has been superseded by a revision', async () => {
    const quoteId = await quotedQuote(customerA);
    expect((await sales.post('/orders').send({ quoteId })).status).toBe(201);

    const revised = await sales.post(`/quoting/quotes/${quoteId}/revise`).send({});
    expect(revised.status).toBe(200);

    const again = await sales.post('/orders').send({ quoteId });
    expect(again.status).toBe(422);
    expect(again.body.reason).toBe('unknown-quote');
  });

  it('422s a quote that does not exist', async () => {
    const response = await sales.post('/orders').send({ quoteId: 'no-such-quote' });
    expect(response.status).toBe(422);
    expect(response.body.reason).toBe('unknown-quote');
  });

  it('422s a draft quote — only a sent quote converts', async () => {
    const draft = await createQuote();
    expect((await putLines(draft)).status).toBe(200);

    const response = await sales.post('/orders').send({ quoteId: draft });
    expect(response.status).toBe(422);
    expect(response.body.reason).toBe('unknown-quote');
  });

  it('422s a sent quote with no lines rather than making an order for nothing', async () => {
    const empty = await createQuote();
    expect((await send(empty)).status).toBe(200);

    const response = await sales.post('/orders').send({ quoteId: empty });
    expect(response.status).toBe(422);
    expect(response.body.reason).toBe('empty-quote');
  });

  it('422s a sent quote that no longer passes the send checks, and makes no order', async () => {
    const quoteId = await quotedQuote(customerA);
    // The quote is put into `quoted` with a hand-set price nobody approved, through the store
    // directly, as no route can leave it.
    const sent = (await quotingStores.quotes.findWithLines(quoteId))!;
    const at = new Date();
    await quotingStores.quotes.transition(quoteId, 'draft', at);
    await quotingStores.quotes.replaceLines(
      quoteId,
      sent.lines.map((l) => ({ ...l, id: newId(), priceSource: 'manual' as const })),
      at,
    );
    await quotingStores.quotes.transition(quoteId, 'quoted', at);
    const broken = (await quotingStores.quotes.findWithLines(quoteId))!;
    expect(broken.status).toBe('quoted');
    expect(broken.overrideApprovedBy).toBeUndefined();

    for (const attempt of [
      sales.post('/orders').send({ quoteId }),
      sales.post('/orders/deliveries').send({
        quoteId,
        deliveries: ['2027-06-10', '2027-07-15'].map((requestedDate) => ({
          requestedDate,
          lines: [{ quoteLineId: broken.lines[0]!.id, quantityRolls: 1 }],
        })),
      }),
    ]) {
      const response = await attempt;
      expect(response.status).toBe(422);
      expect(response.body).toMatchObject({
        reason: 'quote-fails-send-checks',
        value: { quoteId, check: 'override-not-approved', lines: [1] },
      });
    }
    expect((await sales.get('/orders').query({ quoteId })).body.items).toEqual([]);
  });

  it('400s a malformed body', async () => {
    expect((await sales.post('/orders').send({})).status).toBe(400);
    expect((await sales.post('/orders').send({ quoteId: '' })).status).toBe(400);
  });
});

describe('Orders edge — the lines chosen on Create orders', () => {
  let chooseSeq = 0;

  async function ownCustomer(): Promise<string> {
    chooseSeq += 1;
    const created = await sales.post('/crm/customers').send({
      billingAddress: QUOTABLE_BILLING_ADDRESS,
      name: `Create Orders ${String(chooseSeq)}`,
      legacyAccountNumber: `LA-CO-${String(chooseSeq)}`,
    });
    expect(created.status).toBe(201);
    return created.body.id as string;
  }

  interface Line {
    id: string;
    lineNumber: number;
    quoteLineId?: string;
    quantityRolls: number;
    orderedWeightLb?: string;
    productPricePerLb?: string;
    pricePerRoll: string;
    totalCostPerRoll: string;
    rollWeightLb?: string;
    estimatedWeightLb: string;
    extendedPrice: string;
    extendedCost: string;
    freightResult: { invoiceTotal: string; cost: string };
  }

  it('makes an order from a per-pound line at fewer pounds and fewer rolls, at the price per pound', async () => {
    const quoteId = await quotedQuote(await ownCustomer(), [
      { ...plainLine, pricingBasis: 'per_pound', orderedWeightLb: '1000.0000' },
    ]);
    const quoteLine = (await sales.get(`/quoting/quotes/${quoteId}`)).body.lines[0] as {
      id: string;
      productPricePerLb: string;
      pricePerRoll: string;
      estimatedWeightLb: string;
    };

    const created = await sales.post('/orders').send({
      quoteId,
      lines: [{ quoteLineId: quoteLine.id, quantityRolls: 6, orderedWeightLb: '600' }],
    });
    expect(created.status).toBe(201);
    const line = created.body.lines[0] as Line;

    expect(line.productPricePerLb).toBe(quoteLine.productPricePerLb);
    expect(line.pricePerRoll).toBe(quoteLine.pricePerRoll);
    expect(line).toMatchObject({ quantityRolls: 6, orderedWeightLb: '600.0000' });

    expect(line.extendedPrice).toBe(
      toMoney(
        perPoundProductPrice(quoteLine.productPricePerLb, '600').plus(
          toDecimal(line.freightResult.invoiceTotal),
        ),
      ),
    );
    expect(line.extendedCost).toBe(
      toMoney(toDecimal(line.totalCostPerRoll).times(6).plus(toDecimal(line.freightResult.cost))),
    );

    expect(line.rollWeightLb).toBeDefined();
    expect(line.estimatedWeightLb).toBe(toMeasure(toDecimal(line.rollWeightLb ?? '0').times(6)));
    expect(line.estimatedWeightLb).not.toBe(quoteLine.estimatedWeightLb);
  });

  it('refuses a line not on the quote or named twice, and pounds where they do not belong, making no order', async () => {
    const quoteId = await quotedQuote(await ownCustomer(), [
      plainLine,
      { ...plainLine, pricingBasis: 'per_pound', orderedWeightLb: '1000.0000' },
    ]);
    const [perRoll, perPound] = (await sales.get(`/quoting/quotes/${quoteId}`)).body.lines as {
      id: string;
    }[];
    const send = (lines: unknown[]) => sales.post('/orders').send({ quoteId, lines });

    const unknown = await send([{ quoteLineId: newId(), quantityRolls: 2 }]);
    expect(unknown.status).toBe(400);
    expect(unknown.body.reason).toBe('unknown-quote-line');

    const twice = await send([
      { quoteLineId: perRoll?.id, quantityRolls: 2 },
      { quoteLineId: perRoll?.id, quantityRolls: 3 },
    ]);
    expect(twice.status).toBe(400);

    const poundsOnRoll = await send([
      { quoteLineId: perRoll?.id, quantityRolls: 2, orderedWeightLb: '90' },
    ]);
    expect(poundsOnRoll.status).toBe(422);
    expect(poundsOnRoll.body).toMatchObject({
      reason: 'per-roll-ordered-weight',
      value: { lineNumber: 1 },
    });

    const noPounds = await send([{ quoteLineId: perPound?.id, quantityRolls: 5 }]);
    expect(noPounds.status).toBe(422);
    expect(noPounds.body).toMatchObject({
      reason: 'per-pound-line-needs-pounds',
      value: { lineNumber: 2 },
    });

    expect((await sales.get('/orders').query({ quoteId })).body.items).toHaveLength(0);
  });

  it('reads the lines of several orders grouped by order: GET /orders/lines?ids=', async () => {
    const quoteId = await quotedQuote(await ownCustomer(), [
      plainLine,
      { ...plainLine, rollWidthIn: 18 },
    ]);
    const [first, second] = (await sales.get(`/quoting/quotes/${quoteId}`)).body.lines as {
      id: string;
    }[];
    const whole = await sales.post('/orders').send({ quoteId });
    const part = await sales.post('/orders').send({
      quoteId,
      lines: [{ quoteLineId: second?.id, quantityRolls: 4 }],
    });
    expect(whole.status).toBe(201);
    expect(part.status).toBe(201);
    const wholeId = whole.body.id as string;
    const partId = part.body.id as string;

    const read = await sales
      .get('/orders/lines')
      .query({ ids: [wholeId, partId, newId()].join(',') });
    expect(read.status).toBe(200);
    const byOrder = new Map(
      (read.body.items as { orderId: string; lines: Line[] }[]).map((item) => [
        item.orderId,
        item.lines,
      ]),
    );

    expect([...byOrder.keys()].sort()).toEqual([wholeId, partId].sort());
    expect(byOrder.get(wholeId)?.map((line) => line.quoteLineId)).toEqual([first?.id, second?.id]);

    expect(
      byOrder.get(partId)?.map((line) => [line.lineNumber, line.quoteLineId, line.quantityRolls]),
    ).toEqual([[2, second?.id, 4]]);

    expect((await sales.get('/orders/lines')).status).toBe(400);
    expect((await sales.get('/orders/lines').query({ ids: '' })).status).toBe(400);
    expect((await http().get('/orders/lines').query({ ids: wholeId })).status).toBe(401);
  });
});

describe('Orders edge — one order per delivery date in one press', () => {
  let deliveriesSeq = 0;

  async function ownCustomer(): Promise<string> {
    deliveriesSeq += 1;
    const created = await sales.post('/crm/customers').send({
      billingAddress: QUOTABLE_BILLING_ADDRESS,
      name: `Deliveries ${String(deliveriesSeq)}`,
      legacyAccountNumber: `LA-DL-${String(deliveriesSeq)}`,
    });
    expect(created.status).toBe(201);
    return created.body.id as string;
  }

  async function twoLineQuote(): Promise<{ quoteId: string; line1: string; line2: string }> {
    const quoteId = await quotedQuote(
      await ownCustomer(),
      [
        plainLine,
        { ...plainLine, rollWidthIn: 18, pricingBasis: 'per_pound', orderedWeightLb: '1000.0000' },
      ],
      'jsmith',
    );
    const lines = (await sales.get(`/quoting/quotes/${quoteId}`)).body.lines as {
      id: string;
      lineNumber: number;
    }[];
    const byNumber = (n: number) => lines.find((line) => line.lineNumber === n)?.id ?? '';
    return { quoteId, line1: byNumber(1), line2: byNumber(2) };
  }

  async function withReachableManager(email: string, body: () => Promise<void>): Promise<void> {
    const regrant = async (roles: readonly string[], address?: string) => {
      const response = await admin.put('/admin/users/local:dev-billing/roles').send({
        identity: {
          externalId: 'local:dev-billing',
          username: 'dev-billing',
          displayName: 'dev-billing',
          ...(address === undefined ? {} : { email: address }),
        },
        roles,
      });
      expect(response.status).toBe(200);
    };
    await regrant(['ProductionManager'], email);
    try {
      await body();
    } finally {
      await regrant(['Billing']);
    }
  }

  it('makes one order per delivery with the PO number, its date and its lines, and tells the PMs once per order', async () => {
    const { quoteId, line1, line2 } = await twoLineQuote();
    const manager = 'pm-deliveries@example.test';

    await withReachableManager(manager, async () => {
      const before = mailSink.submissions.length;
      const created = await sales.post('/orders/deliveries').send({
        quoteId,
        poNumber: 'PO-DELIVERIES-1',
        deliveries: [
          { requestedDate: '2027-06-10', lines: [{ quoteLineId: line1, quantityRolls: 10 }] },
          {
            requestedDate: '2027-07-15',
            lines: [{ quoteLineId: line2, quantityRolls: 6, orderedWeightLb: '600' }],
          },
        ],
      });
      expect(created.status).toBe(201);
      const items = created.body.items as {
        id: string;
        customerId: string;
        salesRep?: string;
        poNumber?: string;
        requestedDate?: string;
        lines: { lineNumber: number; quantityRolls: number; orderedWeightLb?: string }[];
      }[];
      expect(items).toHaveLength(2);
      const [june, july] = items;
      expect(june).toMatchObject({ poNumber: 'PO-DELIVERIES-1', requestedDate: '2027-06-10' });
      expect(july).toMatchObject({ poNumber: 'PO-DELIVERIES-1', requestedDate: '2027-07-15' });
      expect(june?.lines.map((line) => [line.lineNumber, line.quantityRolls])).toEqual([[1, 10]]);
      expect(july?.lines.map((line) => [line.lineNumber, line.quantityRolls])).toEqual([[2, 6]]);
      expect(july?.lines[0]?.orderedWeightLb).toBe('600.0000');

      const quote = (await sales.get(`/quoting/quotes/${quoteId}`)).body as { customerId: string };
      for (const order of items) {
        expect(order.customerId).toBe(quote.customerId);
        expect(order.salesRep).toBe('jsmith');
      }
      const listed = (await sales.get('/orders').query({ quoteId })).body.items as {
        id: string;
      }[];
      expect(listed.map((order) => order.id).sort()).toEqual(items.map((order) => order.id).sort());

      const alerts = mailSink.submissions
        .slice(before)
        .filter((sent) => sent.mail.to.includes(manager));
      expect(alerts).toHaveLength(2);
      for (const sent of alerts) {
        expect(sent.mail.subject).toContain('PO-DELIVERIES-1');
      }
      for (const order of items) {
        expect(alerts.some((sent) => sent.mail.textBody.includes(`/orders/${order.id}`))).toBe(
          true,
        );
      }
    });
  });

  it('makes none when one delivery is bad: every delivery is checked before anything is written', async () => {
    const { quoteId, line1, line2 } = await twoLineQuote();

    const refused = await sales.post('/orders/deliveries').send({
      quoteId,
      deliveries: [
        { requestedDate: '2027-06-10', lines: [{ quoteLineId: line1, quantityRolls: 10 }] },
        { requestedDate: '2027-07-15', lines: [{ quoteLineId: line2, quantityRolls: 5 }] },
      ],
    });
    expect(refused.status).toBe(422);
    expect(refused.body).toMatchObject({
      reason: 'per-pound-line-needs-pounds',
      value: { lineNumber: 2 },
    });

    const unknown = await sales.post('/orders/deliveries').send({
      quoteId,
      deliveries: [
        { requestedDate: '2027-06-10', lines: [{ quoteLineId: line1, quantityRolls: 10 }] },
        { requestedDate: '2027-07-15', lines: [{ quoteLineId: newId(), quantityRolls: 5 }] },
      ],
    });
    expect(unknown.status).toBe(400);
    expect(unknown.body.reason).toBe('unknown-quote-line');

    expect((await sales.get('/orders').query({ quoteId })).body.items).toHaveLength(0);
  });

  it('refuses one delivery, two on the same date, and a delivery with no date or no lines; and a stranger', async () => {
    const { quoteId, line1 } = await twoLineQuote();
    const delivery = (requestedDate: string) => ({
      requestedDate,
      lines: [{ quoteLineId: line1, quantityRolls: 2 }],
    });
    const send = (deliveries: unknown[]) =>
      sales.post('/orders/deliveries').send({ quoteId, deliveries });

    expect((await send([delivery('2027-06-10')])).status).toBe(400);
    expect((await send([delivery('2027-06-10'), delivery('2027-06-10')])).status).toBe(400);
    expect(
      (await send([delivery('2027-06-10'), { lines: [{ quoteLineId: line1, quantityRolls: 2 }] }]))
        .status,
    ).toBe(400);
    expect(
      (await send([delivery('2027-06-10'), { requestedDate: '2027-07-15', lines: [] }])).status,
    ).toBe(400);
    expect(
      (
        await http()
          .post('/orders/deliveries')
          .send({ quoteId, deliveries: [delivery('2027-06-10'), delivery('2027-07-15')] })
      ).status,
    ).toBe(401);

    expect((await sales.get('/orders').query({ quoteId })).body.items).toHaveLength(0);
  });
});

describe('Orders edge — recording the customer PO number', () => {
  const po = (suffix: string) => ({ poNumber: `PO-CAPTURE-${suffix}` });

  it('records the PO number and reads it back on the order', async () => {
    const orderId = await convert(await quotedQuote(customerB));
    const PO = po('READBACK');

    const captured = await sales
      .put(`/orders/${orderId}/purchase-order`)
      .send({ ...PO, lockVersion: await lockVersionOf(orderId) });
    expect(captured.status).toBe(200);
    expect(captured.body.poNumber).toBe(PO.poNumber);

    expect(captured.body).not.toHaveProperty('poLines');

    const reread = await sales.get(`/orders/${orderId}`);
    expect(reread.body.poNumber).toBe(PO.poNumber);
  });

  it('replaces the number on re-capture, which is how a corrected PO is entered', async () => {
    const orderId = await convert(await quotedQuote(customerB));
    await sales
      .put(`/orders/${orderId}/purchase-order`)
      .send({ ...po('REV'), lockVersion: await lockVersionOf(orderId) });

    const corrected = await sales.put(`/orders/${orderId}/purchase-order`).send({
      lockVersion: await lockVersionOf(orderId),
      poNumber: 'PO-CAPTURE-1-REV',
    });
    expect(corrected.status).toBe(200);
    expect(corrected.body.poNumber).toBe('PO-CAPTURE-1-REV');
  });

  it('clears the number, and who recorded it, when none is sent', async () => {
    const orderId = await convert(await quotedQuote(customerB));
    await sales
      .put(`/orders/${orderId}/purchase-order`)
      .send({ ...po('CLEAR'), lockVersion: await lockVersionOf(orderId) });

    const cleared = await sales
      .put(`/orders/${orderId}/purchase-order`)
      .send({ lockVersion: await lockVersionOf(orderId) });
    expect(cleared.status).toBe(200);
    expect(cleared.body.poNumber).toBeUndefined();
    expect(cleared.body.poCapturedBy).toBeUndefined();
    expect(cleared.body.poCapturedAt).toBeUndefined();
  });

  it('takes free text, "approved by customer" included, on two orders of one customer', async () => {
    const first = await convert(await quotedQuote(customerA));
    const second = await convert(await quotedQuote(customerA));
    const verbal = { poNumber: 'approved by customer' };

    for (const orderId of [first, second]) {
      const captured = await sales
        .put(`/orders/${orderId}/purchase-order`)
        .send({ ...verbal, lockVersion: await lockVersionOf(orderId) });
      expect(captured.status).toBe(200);
      expect(captured.body.poNumber).toBe('approved by customer');
    }
  });

  it('400s a number longer than 64 characters', async () => {
    const orderId = await convert(await quotedQuote(customerB));
    expect(
      (
        await sales
          .put(`/orders/${orderId}/purchase-order`)
          .send({ poNumber: 'x'.repeat(65), lockVersion: await lockVersionOf(orderId) })
      ).status,
    ).toBe(400);
  });

  it('404s an unknown order', async () => {
    expect(
      (
        await sales
          .put('/orders/00000000-0000-4000-8000-000000000000/purchase-order')
          .send({ ...po('NOWHERE'), lockVersion: 1 })
      ).status,
    ).toBe(404);
  });

  it('lets any authenticated user capture, and records who did', async () => {
    const orderId = await convert(await quotedQuote(customerB));

    const captured = await noroles
      .put(`/orders/${orderId}/purchase-order`)
      .send({ ...po('ANYUSER'), lockVersion: await lockVersionOf(orderId) });
    expect(captured.status).toBe(200);

    expect(captured.body.poCapturedBy).toBe('dev-noroles');
    expect(typeof captured.body.poCapturedAt).toBe('string');
  });

  it('takes the actor from the session, never from the body', async () => {
    const orderId = await convert(await quotedQuote(customerB));

    const captured = await sales.put(`/orders/${orderId}/purchase-order`).send({
      lockVersion: await lockVersionOf(orderId),
      ...po('FORGED'),
      capturedBy: 'somebody-else',
    });
    expect(captured.status).toBe(200);
    expect(captured.body.poCapturedBy).toBe('dev-sales');
  });

  it('records a PO number sent with the conversion itself', async () => {
    const created = await sales
      .post('/orders')
      .send({ quoteId: await quotedQuote(customerB), poNumber: 'PO-AT-CONVERT' });
    expect(created.status).toBe(201);
    expect(created.body.poNumber).toBe('PO-AT-CONVERT');
    expect(created.body.poCapturedBy).toBe('dev-sales');
  });
});

describe('Orders edge — totals, derived from stored lines', () => {
  it('sums the order to what its lines were committed at', async () => {
    const orderId = await convert(await quotedQuote(customerB));
    const order = await sales.get(`/orders/${orderId}`);
    expect(order.status).toBe(200);
    const line = order.body.lines[0];

    const batched = await sales.get('/orders/totals').query({ ids: orderId });
    expect(batched.status).toBe(200);
    const totals = batched.body.items[0].totals;

    expect(totals.extendedPrice).toBe(roundToCents(line.extendedPrice));
    expect(totals.extendedCost).toBe(roundToCents(line.extendedCost));

    expect(totals.estimatedWeightLb).toBe(line.estimatedWeightLb);

    expect(totals.freightCost).toBe(roundToCents(line.freightResult.cost));
    expect(totals.freightMargin).toBe(roundToCents(line.freightResult.margin));
    expect(totals.freightPending).toBe(line.freightResult.pending);

    expect(totals).not.toHaveProperty('orderTotal');
  });

  it('answers one row per id that resolves, deduplicated, omitting the unknown', async () => {
    const batched = await sales
      .get('/orders/totals')
      .query({ ids: `${orderA1},no-such-order,${orderA1},${orderB1}` });
    expect(batched.status).toBe(200);

    const ids = (batched.body.items as { orderId: string }[]).map((i) => i.orderId);
    expect(ids.sort()).toEqual([orderA1, orderB1].sort());
  });

  it('400s a missing or bare ids param rather than answering everything', async () => {
    expect((await sales.get('/orders/totals')).status).toBe(400);
    expect((await sales.get('/orders/totals').query({ ids: '' })).status).toBe(400);
    expect((await sales.get('/orders/totals').query({ ids: ' , ,' })).status).toBe(400);
  });

  it('reads /orders/totals as the static route, not as an order id', async () => {
    expect((await sales.get('/orders/totals').query({ ids: orderA1 })).status).toBe(200);
  });

  it('404s an unknown order on the per-id read', async () => {
    expect((await sales.get('/orders/00000000-0000-4000-8000-000000000000')).status).toBe(404);
  });

  it('answers one order on its own route, matching the batched figures', async () => {
    const orderId = await convert(await quotedQuote(customerB));

    const single = await sales.get(`/orders/${orderId}/totals`);
    expect(single.status).toBe(200);

    const batched = await sales.get('/orders/totals').query({ ids: orderId });
    expect(single.body).toEqual(batched.body.items[0].totals);
  });

  it('404s an unknown order on the per-order totals route', async () => {
    expect((await sales.get('/orders/00000000-0000-4000-8000-000000000000/totals')).status).toBe(
      404,
    );
    const batched = await sales.get('/orders/totals').query({ ids: 'no-such-order' });
    expect(batched.status).toBe(200);
    expect(batched.body.items).toEqual([]);
  });

  it('lets any signed-in user read an order total', async () => {
    expect((await noroles.get(`/orders/${orderA1}/totals`)).status).toBe(200);
  });
});

describe('Orders edge — lifecycle history', () => {
  let seq = 0;

  it('opens with the conversion itself, so the history has a beginning', async () => {
    const orderId = await convert(await quotedQuote(customerB));

    const response = await sales.get(`/orders/${orderId}/transitions`);
    expect(response.status).toBe(200);

    expect(response.body.items).toHaveLength(1);
    expect(response.body.items[0]).toMatchObject({
      orderId,
      from: null,
      to: 'converted',
      actor: 'dev-sales',
      reason: 'converted from quote',
    });
  });

  it('credits the user who converted, not the rep who sold the quote', async () => {
    const quoteId = await quotedQuote(customerB, undefined, 'jsmith');
    const orderId = await convert(quoteId);

    const order = await sales.get(`/orders/${orderId}`);
    expect(order.body.salesRep).toBe('jsmith');

    const response = await sales.get(`/orders/${orderId}/transitions`);
    expect(response.status).toBe(200);
    expect(response.body.items[0]).toMatchObject({ from: null, actor: 'dev-sales' });
  });

  it('reads oldest first, in the order things happened', async () => {
    seq += 1;
    const orderId = await convert(await quotedQuote(customerB));
    await fileFullPurchaseOrder(orderId, {
      poNumber: `PO-HISTORY-${seq}`,
      lines: [{ lineNumber: 1, paper: 'kraft', poundage: '37.0000', rolls: 10 }],
    });
    await orderService.transition(
      orderId,
      { to: 'confirmed' },
      { actor: 'dev-pm', confirmedLeadTimeDays: 7 },
    );

    const response = await sales.get(`/orders/${orderId}/transitions`);
    expect(response.status).toBe(200);
    expect((response.body.items as { to: string }[]).map((t) => t.to)).toEqual([
      'converted',
      'confirmed',
    ]);
  });

  it('404s an unknown order rather than answering an empty history', async () => {
    expect(
      (await sales.get('/orders/00000000-0000-4000-8000-000000000000/transitions')).status,
    ).toBe(404);
  });

  it('lets any signed-in user read the history', async () => {
    expect((await noroles.get(`/orders/${orderA1}/transitions`)).status).toBe(200);
  });
});

const JPEG_BYTES = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64)]);

describe('Orders edge — attaching the customer PO', () => {
  it('rejects an anonymous upload, list and download', async () => {
    expect((await uploadPo(http(), orderA1, PDF_BYTES, 'po.pdf', 'application/pdf')).status).toBe(
      401,
    );
    expect((await http().get(`/orders/${orderA1}/documents`)).status).toBe(401);
    expect((await http().get(`/orders/${orderA1}/documents/whatever`)).status).toBe(401);
  });

  it('lets any authenticated user attach one — whoever opens the mail', async () => {
    const response = await uploadPo(noroles, orderB1, PDF_BYTES, 'PO 63094.pdf', 'application/pdf');
    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      kind: 'purchase_order',
      subject: { type: 'order', id: orderB1 },
      contentType: 'application/pdf',
      source: 'received',
      uploadedBy: 'dev-noroles',
      byteSize: PDF_BYTES.byteLength,
    });

    expect(response.body.filename).toBe('PO-63094.pdf');
  });

  it('never hands the storage path to a client', async () => {
    const response = await uploadPo(sales, orderA2, PDF_BYTES, 'po.pdf', 'application/pdf');
    expect(response.status).toBe(201);

    expect(response.body).not.toHaveProperty('storagePath');
  });

  it('stores what the bytes are, not what the upload claimed', async () => {
    const response = await uploadPo(sales, orderA1, JPEG_BYTES, 'scan.pdf', 'application/pdf');
    expect(response.status).toBe(201);
    expect(response.body.contentType).toBe('image/jpeg');

    expect(response.body.filename).toBe('scan.jpg');
  });

  it('415s a format we do not accept, whatever it claims to be', async () => {
    const html = Buffer.from('<html><script>alert(1)</script></html>');
    const response = await uploadPo(sales, orderA1, html, 'po.pdf', 'application/pdf');
    expect(response.status).toBe(415);
    expect(response.body.reason).toBe('unsupported-document-type');
  });

  it('400s a request with no file attached', async () => {
    const response = await sales.post(`/orders/${orderA1}/purchase-order/document`).send({});
    expect(response.status).toBe(400);
  });

  it('404s before writing anything when the order does not exist', async () => {
    const response = await uploadPo(sales, 'no-such-order', PDF_BYTES, 'po.pdf', 'application/pdf');
    expect(response.status).toBe(404);
  });

  it('lists what is filed against the order, and only that order', async () => {
    const response = await sales.get(`/orders/${orderB1}/documents`);
    expect(response.status).toBe(200);
    const filenames = (response.body.documents as { filename: string }[]).map((d) => d.filename);
    expect(filenames).toContain('PO-63094.pdf');

    expect(filenames).not.toContain('scan.jpg');
  });

  it('serves the bytes back as an attachment, never inline', async () => {
    const uploaded = await uploadPo(sales, orderB1, PDF_BYTES, 'served.pdf', 'application/pdf');
    expect(uploaded.status).toBe(201);

    const response = await sales
      .get(`/orders/${orderB1}/documents/${uploaded.body.id}`)
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => callback(null, Buffer.concat(chunks)));
      });

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('application/pdf');

    expect(response.headers['content-disposition']).toContain('attachment');
    expect(response.headers['content-disposition']).not.toContain('inline');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(Buffer.from(response.body as Buffer).equals(PDF_BYTES)).toBe(true);
  });

  it('keeps the name the customer sent, and still stores an ASCII one', async () => {
    const uploaded = await uploadPo(sales, orderB1, PDF_BYTES, '発注書 📄.pdf', 'application/pdf');
    expect(uploaded.status).toBe(201);
    expect(uploaded.body.filename).toBe('document.pdf');
    expect(uploaded.body.originalFilename).toBe('発注書 📄.pdf');
  });

  it('serves that name over RFC 6266 rather than crashing on it', async () => {
    const uploaded = await uploadPo(sales, orderA2, PDF_BYTES, '発注書 📄.pdf', 'application/pdf');
    expect(uploaded.status).toBe(201);

    const response = await sales.get(`/orders/${orderA2}/documents/${uploaded.body.id}`);
    expect(response.status).toBe(200);
    const disposition = response.headers['content-disposition'] as string;

    expect(disposition).toMatch(/^attachment; filename="[\x20-\x7E]*";/);

    expect(disposition).toContain(`filename*=UTF-8''${encodeURIComponent('発注書 📄.pdf')}`);
  });

  it('normalises a filename that is nothing but whitespace to no name at all', async () => {
    const uploaded = await uploadPo(sales, orderA1, PDF_BYTES, '   ', 'application/pdf');
    expect(uploaded.status).toBe(201);
    expect(uploaded.body.originalFilename).toBeNull();
    expect(uploaded.body.filename).toBe('document.pdf');
  });

  it('404s a document id that belongs to a different order', async () => {
    const elsewhere = await uploadPo(sales, orderA1, PDF_BYTES, 'other.pdf', 'application/pdf');
    expect(elsewhere.status).toBe(201);

    expect((await sales.get(`/orders/${orderB1}/documents/${elsewhere.body.id}`)).status).toBe(404);
  });

  it('files every upload as received — nothing here was generated by us', async () => {
    const documents = await sales.get(`/orders/${orderB1}/documents`);
    expect(documents.status).toBe(200);
    expect(
      (documents.body.documents as { source: string }[]).every((d) => d.source === 'received'),
    ).toBe(true);
  });
});

describe('Orders edge — nothing about the PO blocks confirmation', () => {
  it('confirms an order with no PO number and no PO document', async () => {
    const orderId = await convert(await quotedQuote(customerB));

    const moved = await orderService.transition(
      orderId,
      { to: 'confirmed' },
      { actor: 'dev-pm', confirmedLeadTimeDays: 7 },
    );
    expect(moved?.status).toBe('confirmed');
    expect(moved?.poNumber).toBeUndefined();
  });
});

describe('Orders edge — Production confirms the order', () => {
  let seq = 0;

  async function readyToConfirm(): Promise<string> {
    seq += 1;
    const orderId = await convert(await quotedQuote(customerB));
    await fileFullPurchaseOrder(orderId, {
      poNumber: `PO-CONFIRM-${seq}`,
      lines: [{ lineNumber: 1, paper: 'kraft', poundage: '37.0000', rolls: 10 }],
    });
    return orderId;
  }

  it('confirms, mints the job number and records who signed it off', async () => {
    const orderId = await readyToConfirm();

    const response = await production
      .post(`/orders/${orderId}/confirm`)
      .send({ lockVersion: await lockVersionOf(orderId), confirmedLeadTimeDays: 14 });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      status: 'confirmed',
      confirmedLeadTimeDays: 14,

      confirmedBy: 'dev-production',
    });
    expect(response.body.jobNumber).toMatch(/^DPW-\d{5,}$/);
    expect(typeof response.body.confirmedAt).toBe('string');
  });

  it('takes the confirmer from the session, not the body', async () => {
    const orderId = await readyToConfirm();

    const response = await production.post(`/orders/${orderId}/confirm`).send({
      lockVersion: await lockVersionOf(orderId),
      confirmedLeadTimeDays: 3,
      confirmedBy: 'someone-else',
    });

    expect(response.status).toBe(200);
    expect(response.body.confirmedBy).toBe('dev-production');
  });

  it('gives each confirmed order its own job number', async () => {
    const first = await readyToConfirm();
    const second = await readyToConfirm();

    const a = await production
      .post(`/orders/${first}/confirm`)
      .send({ lockVersion: await lockVersionOf(first), confirmedLeadTimeDays: 2 });
    const b = await production
      .post(`/orders/${second}/confirm`)
      .send({ lockVersion: await lockVersionOf(second), confirmedLeadTimeDays: 2 });

    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(a.body.jobNumber).not.toBe(b.body.jobNumber);
  });

  it('accepts a same-day commitment of zero days', async () => {
    const orderId = await readyToConfirm();

    const response = await production
      .post(`/orders/${orderId}/confirm`)
      .send({ lockVersion: await lockVersionOf(orderId), confirmedLeadTimeDays: 0 });

    expect(response.status).toBe(200);
    expect(response.body.confirmedLeadTimeDays).toBe(0);
  });

  it('refuses a request with no lead time', async () => {
    const orderId = await readyToConfirm();

    const response = await production
      .post(`/orders/${orderId}/confirm`)
      .send({ lockVersion: await lockVersionOf(orderId) });

    expect(response.status).toBe(400);
  });

  it('is closed to roles that do not run production', async () => {
    const orderId = await readyToConfirm();

    expect(
      (
        await sales
          .post(`/orders/${orderId}/confirm`)
          .send({ lockVersion: await lockVersionOf(orderId), confirmedLeadTimeDays: 5 })
      ).status,
    ).toBe(403);
    expect(
      (
        await noroles
          .post(`/orders/${orderId}/confirm`)
          .send({ lockVersion: await lockVersionOf(orderId), confirmedLeadTimeDays: 5 })
      ).status,
    ).toBe(403);

    expect((await sales.get(`/orders/${orderId}`)).body.status).toBe('converted');
  });

  it('confirms with no PO at all', async () => {
    const orderId = await convert(await quotedQuote(customerB));

    const response = await production
      .post(`/orders/${orderId}/confirm`)
      .send({ lockVersion: await lockVersionOf(orderId), confirmedLeadTimeDays: 5 });

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('confirmed');
  });

  it('409s when the order is already confirmed', async () => {
    const orderId = await readyToConfirm();
    expect(
      (
        await production
          .post(`/orders/${orderId}/confirm`)
          .send({ lockVersion: await lockVersionOf(orderId), confirmedLeadTimeDays: 4 })
      ).status,
    ).toBe(200);

    const again = await production
      .post(`/orders/${orderId}/confirm`)
      .send({ lockVersion: await lockVersionOf(orderId), confirmedLeadTimeDays: 4 });

    expect(again.status).toBe(409);
  });

  it('404s for an order that does not exist', async () => {
    const response = await production
      .post('/orders/01988a00-0100-7000-8000-0000000000ff/confirm')
      .send({ lockVersion: 1, confirmedLeadTimeDays: 5 });

    expect(response.status).toBe(404);
  });
});

describe('Orders edge — issuing the order confirmation', () => {
  let seq = 0;

  async function confirmedOrderFor(customerId: string): Promise<string> {
    seq += 1;
    const orderId = await convert(await quotedQuote(customerId));
    await fileFullPurchaseOrder(orderId, {
      poNumber: `PO-OC-${seq}`,
      lines: [{ lineNumber: 1, paper: 'kraft', poundage: '37.0000', rolls: 10 }],
    });
    const confirmed = await production
      .post(`/orders/${orderId}/confirm`)
      .send({ lockVersion: await lockVersionOf(orderId), confirmedLeadTimeDays: 10 });
    expect(confirmed.status).toBe(200);
    return orderId;
  }

  let withContact: string;
  let withoutContact: string;
  let resend: string;

  beforeAll(async () => {
    const customerWith = (
      await sales.post('/crm/customers').send({
        billingAddress: QUOTABLE_BILLING_ADDRESS,
        name: 'OC Recipient Co',
        legacyAccountNumber: 'LA-O-OC1',
      })
    ).body.id;
    const contact = await sales
      .post(`/crm/customers/${customerWith}/contacts`)
      .send({ name: 'Accounts Payable', email: 'ap@oc-recipient.example.com' });
    expect(contact.status).toBe(201);

    expect(
      (
        await sales
          .patch(`/crm/customers/${customerWith}/contacts/${contact.body.id}`)
          .send({ roles: [...MAIL_CONTACT_ROLES], lockVersion: contact.body.lockVersion })
      ).status,
    ).toBe(200);
    withContact = await confirmedOrderFor(customerWith);

    const customerWithout = (
      await sales.post('/crm/customers').send({
        billingAddress: QUOTABLE_BILLING_ADDRESS,
        name: 'OC No Contact Co',
        legacyAccountNumber: 'LA-O-OC2',
      })
    ).body.id;
    withoutContact = await confirmedOrderFor(customerWithout);

    const customerResend = (
      await sales.post('/crm/customers').send({
        billingAddress: QUOTABLE_BILLING_ADDRESS,
        name: 'OC Resend Co',
        legacyAccountNumber: 'LA-O-OC3',
      })
    ).body.id;
    const resendContact = await sales
      .post(`/crm/customers/${customerResend}/contacts`)
      .send({ name: 'AP', email: 'ap@oc-resend.example.com' });
    expect(resendContact.status).toBe(201);
    expect(
      (
        await sales
          .patch(`/crm/customers/${customerResend}/contacts/${resendContact.body.id}`)
          .send({ roles: [...MAIL_CONTACT_ROLES], lockVersion: resendContact.body.lockVersion })
      ).status,
    ).toBe(200);
    resend = await confirmedOrderFor(customerResend);
  });

  it('renders the OC, stores it against the order, and mails the customer', async () => {
    const orderId = withContact;

    const response = await production.post(`/orders/${orderId}/confirmation`);

    expect(response.status).toBe(200);

    expect(response.body.recipients).toEqual(['ap@oc-recipient.example.com']);

    expect(response.body.messageId).toMatch(/^<.+@.+>$/);
    expect(response.body.document).toMatchObject({
      kind: 'order_confirmation',
      contentType: 'application/pdf',
    });
    expect(response.body.document.byteSize).toBeGreaterThan(1000);

    const filed = await sales.get(`/orders/${orderId}/documents`);
    expect(filed.status).toBe(200);
    expect(
      filed.body.documents.some(
        (d: { kind: string; id: string }) =>
          d.kind === 'order_confirmation' && d.id === response.body.document.id,
      ),
    ).toBe(true);
  });

  it('refuses before the order is confirmed — 409, and nothing is filed', async () => {
    const orderId = await convert(await quotedQuote(customerB));

    const response = await production.post(`/orders/${orderId}/confirmation`);

    expect(response.status).toBe(409);
    expect(response.body.reason).toBe('order-not-confirmed');
    expect(response.body.value.status).toBe('converted');
  });

  it('refuses when the customer has no address, as a CRM problem not a mail one', async () => {
    const orderId = withoutContact;

    const response = await production.post(`/orders/${orderId}/confirmation`);

    expect(response.status).toBe(422);

    expect(response.body.reason).toBe('no-order-confirmation-recipient');
  });

  it('404s an order that does not exist', async () => {
    const response = await production.post(`/orders/${orderA1.replace(/.$/, '0')}0/confirmation`);

    expect([404, 400]).toContain(response.status);
  });

  it('can be issued again, and files a second copy', async () => {
    const orderId = resend;

    const first = await production.post(`/orders/${orderId}/confirmation`);
    const second = await production.post(`/orders/${orderId}/confirmation`);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body.document.id).not.toBe(first.body.document.id);
    expect(second.body.messageId).not.toBe(first.body.messageId);
  });
});

describe('GET /orders/:id/sends — what we told anyone about the order', () => {
  it('404s an unknown order rather than answering an empty list', async () => {
    expect((await sales.get('/orders/01a00000-0000-7000-8000-00000000dead/sends')).status).toBe(
      404,
    );
  });

  it('lists the order confirmation sent to the customer', async () => {
    const customerId = (
      await sales.post('/crm/customers').send({
        billingAddress: QUOTABLE_BILLING_ADDRESS,
        name: 'OC Sends Co',
        legacyAccountNumber: 'LA-O-OC4',
      })
    ).body.id;
    const contact = await sales
      .post(`/crm/customers/${customerId}/contacts`)
      .send({ name: 'AP', email: 'ap@oc-sends.example.com' });
    expect(contact.status).toBe(201);
    expect(
      (
        await sales
          .patch(`/crm/customers/${customerId}/contacts/${contact.body.id}`)
          .send({ roles: [...MAIL_CONTACT_ROLES], lockVersion: contact.body.lockVersion })
      ).status,
    ).toBe(200);
    const orderId = await convert(await quotedQuote(customerId));
    const confirmed = await production
      .post(`/orders/${orderId}/confirm`)
      .send({ lockVersion: await lockVersionOf(orderId), confirmedLeadTimeDays: 10 });
    expect(confirmed.status).toBe(200);
    expect((await production.post(`/orders/${orderId}/confirmation`)).status).toBe(200);

    const response = await sales.get(`/orders/${orderId}/sends`);
    expect(response.status).toBe(200);
    const customer = (
      response.body.items as { audience: string; outcome: string; recipients: string[] }[]
    ).filter((send) => send.audience === 'customer');
    expect(customer).toHaveLength(1);
    expect(customer[0]).toMatchObject({
      outcome: 'accepted',
      recipients: ['ap@oc-sends.example.com'],
    });
  });

  it('names the user who sent the confirmation, not the one who confirmed the order', async () => {
    const customerId = (
      await sales.post('/crm/customers').send({
        billingAddress: QUOTABLE_BILLING_ADDRESS,
        name: 'OC Sender Co',
        legacyAccountNumber: 'LA-O-OC5',
      })
    ).body.id;
    const contact = await sales
      .post(`/crm/customers/${customerId}/contacts`)
      .send({ name: 'AP', email: 'ap@oc-sender.example.com' });
    expect(contact.status).toBe(201);
    expect(
      (
        await sales
          .patch(`/crm/customers/${customerId}/contacts/${contact.body.id}`)
          .send({ roles: [...MAIL_CONTACT_ROLES], lockVersion: contact.body.lockVersion })
      ).status,
    ).toBe(200);
    const orderId = await convert(await quotedQuote(customerId));
    const confirmed = await productionManager
      .post(`/orders/${orderId}/confirm`)
      .send({ lockVersion: await lockVersionOf(orderId), confirmedLeadTimeDays: 10 });
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.confirmedBy).toBe('dev-production-manager');

    expect((await sales.post(`/orders/${orderId}/confirmation`)).status).toBe(200);

    const response = await sales.get(`/orders/${orderId}/sends`);
    expect(response.status).toBe(200);
    const customer = (response.body.items as { audience: string; actor: string }[]).filter(
      (send) => send.audience === 'customer',
    );
    expect(customer).toHaveLength(1);
    expect(customer[0]?.actor).toBe('dev-sales');
  });

  it('admits a signed-in user with no roles, and refuses anonymous', async () => {
    expect((await http().get(`/orders/${orderA1}/sends`)).status).toBe(401);
    expect((await noroles.get(`/orders/${orderA1}/sends`)).status).toBe(200);
  });
});

describe('Orders edge — a refused confirmation files nothing', () => {
  it('does not store an OC for an order it then refuses', async () => {
    const orderId = await convert(await quotedQuote(customerB));

    const refused = await production.post(`/orders/${orderId}/confirmation`);
    expect(refused.status).toBe(409);

    const filed = await sales.get(`/orders/${orderId}/documents`);
    expect(filed.status).toBe(200);
    expect(
      filed.body.documents.some((d: { kind: string }) => d.kind === 'order_confirmation'),
    ).toBe(false);
  });
});

describe('Orders edge — every state-changing route carries a lockVersion', () => {
  let seq = 0;

  async function withPurchaseOrder(): Promise<string> {
    seq += 1;
    const orderId = await convert(await quotedQuote(customerB));
    await fileFullPurchaseOrder(orderId, {
      poNumber: `PO-LOCKV-${seq}`,
      lines: [{ lineNumber: 1, paper: 'kraft', poundage: '37.0000', rolls: 10 }],
    });
    return orderId;
  }

  async function stale(orderId: string): Promise<number> {
    return (await lockVersionOf(orderId)) - 1;
  }

  function expectStale(response: request.Response, expected: number): void {
    expect(response.status).toBe(409);
    expect(response.body.reason).toBe('stale-aggregate');
    expect(response.body.value).toMatchObject({ aggregate: 'order', expected });
    expect(response.body.value.actual).toBeGreaterThan(expected);
  }

  it('POST :id/confirm refuses a stale token, accepts the current one, 400s none', async () => {
    const orderId = await withPurchaseOrder();
    const behind = await stale(orderId);

    expectStale(
      await production
        .post(`/orders/${orderId}/confirm`)
        .send({ confirmedLeadTimeDays: 7, lockVersion: behind }),
      behind,
    );
    expect((await sales.get(`/orders/${orderId}`)).body.jobNumber).toBeUndefined();

    expect(
      (await production.post(`/orders/${orderId}/confirm`).send({ confirmedLeadTimeDays: 7 }))
        .status,
    ).toBe(400);

    const confirmed = await production
      .post(`/orders/${orderId}/confirm`)
      .send({ confirmedLeadTimeDays: 7, lockVersion: await lockVersionOf(orderId) });
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.status).toBe('confirmed');
  });

  it('PUT :id/purchase-order refuses a stale token, accepts the current one, 400s none', async () => {
    seq += 1;
    const orderId = await convert(await quotedQuote(customerB));
    const attached = await uploadPo(
      sales,
      orderId,
      PDF_BYTES,
      `PO-LOCKV-CAP-${seq}.pdf`,
      'application/pdf',
    );
    expect(attached.status).toBe(201);
    const lines = [{ lineNumber: 1, paper: 'kraft', poundage: '37.0000', rolls: 10 }];
    // A converted order is at its first version, so a first capture moves it on and leaves a
    // version behind it to be stale.
    const first = await sales.put(`/orders/${orderId}/purchase-order`).send({
      poNumber: `PO-LOCKV-CAP-${seq}-A`,
      lines,
      lockVersion: await lockVersionOf(orderId),
    });
    expect(first.status).toBe(200);
    const po = { poNumber: `PO-LOCKV-CAP-${seq}`, lines };
    const behind = await stale(orderId);

    expectStale(
      await sales.put(`/orders/${orderId}/purchase-order`).send({ ...po, lockVersion: behind }),
      behind,
    );
    expect((await sales.get(`/orders/${orderId}`)).body.poNumber).toBe(`PO-LOCKV-CAP-${seq}-A`);

    expect((await sales.put(`/orders/${orderId}/purchase-order`).send(po)).status).toBe(400);

    const captured = await sales
      .put(`/orders/${orderId}/purchase-order`)
      .send({ ...po, lockVersion: await lockVersionOf(orderId) });
    expect(captured.status).toBe(200);
    expect(captured.body.poNumber).toBe(po.poNumber);
  });
});

describe('Orders edge — the PMs are told when an order is converted', () => {
  let seq = 0;

  async function grant(username: string, roles: readonly string[], email?: string) {
    const admin = await loginAgent('break-glass', BREAK_GLASS_PASSWORD);
    const response = await admin.put(`/admin/users/local:${username}/roles`).send({
      identity: {
        externalId: `local:${username}`,
        username,
        displayName: username,
        ...(email === undefined ? {} : { email }),
      },
      roles,
    });
    expect(response.status).toBe(200);
  }

  it('tells the PMs on conversion, naming the PO number sent with it', async () => {
    await grant('dev-billing', ['ProductionManager'], 'pm-billing@example.test');
    seq += 1;
    const poNumber = `PO-ALERT-${seq}`;

    const quoteId = await quotedQuote(customerB);
    const before = mailSink.submissions.length;
    const created = await sales.post('/orders').send({ quoteId, poNumber });
    expect(created.status).toBe(201);

    const sent = mailSink.submissions.slice(before);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.mail.to).toEqual(['pm-billing@example.test']);
    expect(sent[0]?.mail.subject).toContain(poNumber);
    expect(sent[0]?.mail.textBody).toContain('Confirm material and lead time');
  });

  it('tells them about a verbal order too, without claiming a PO', async () => {
    await grant('dev-billing', ['ProductionManager'], 'pm-billing@example.test');

    const quoteId = await quotedQuote(customerB);
    const before = mailSink.submissions.length;
    const orderId = await convert(quoteId);

    const sent = mailSink.submissions.slice(before);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.mail.subject).toContain('New order to confirm');
    expect(sent[0]?.mail.subject).not.toContain('PO');

    const quote = await sales.get(`/quoting/quotes/${quoteId}`);
    expect(quote.status).toBe(200);
    const reference = quoteReference(quote.body as { quoteNumber: number; versionNumber: number });
    expect(sent[0]?.mail.subject).toContain(`Order from ${reference} for `);
    const body = sent[0]?.mail.textBody ?? '';
    const link = `${WEB_BASE_URL}/orders/${orderId}`;
    expect(body).toContain(`Open the order: ${link}\n`);
    expect(new URL(link).pathname).toBe(`/orders/${orderId}`);
    expect(body.replace(link, '')).not.toContain(orderId);
  });

  it('sends nothing when the PO number is recorded later', async () => {
    await grant('dev-billing', ['ProductionManager'], 'pm-billing@example.test');
    const orderId = await convert(await quotedQuote(customerB));
    seq += 1;

    const before = mailSink.submissions.length;
    const captured = await sales.put(`/orders/${orderId}/purchase-order`).send({
      lockVersion: await lockVersionOf(orderId),
      poNumber: `PO-ALERT-${seq}`,
    });
    expect(captured.status).toBe(200);
    expect(mailSink.submissions.slice(before)).toHaveLength(0);
  });

  it('still converts when no ProductionManager has an address', async () => {
    await grant('dev-billing', ['Billing']);

    const quoteId = await quotedQuote(customerB);
    const before = mailSink.submissions.length;
    const rowsBefore = sendLog.rows.length;

    const orderId = await convert(quoteId);

    expect(mailSink.submissions.slice(before)).toHaveLength(0);

    const [row] = sendLog.rows.slice(rowsBefore);
    expect(row).toMatchObject({
      audience: 'internal',
      outcome: 'failed',
      failureReason: 'no-addresses',
      recipients: [],
      subject: { type: 'order', id: orderId },
    });
    expect(row?.unreachableHolders).toContain('dev-production-manager');

    expect(row?.actor).toBe('dev-sales');
  });

  it('resolves recipients through the role, not through a hardcoded address', async () => {
    await grant('dev-billing', ['ProductionManager'], 'pm-one@example.test');
    await grant('dev-admin', ['ProductionManager'], 'pm-two@example.test');

    const stores = app.get<{ users: { listByRole: (r: string) => Promise<{ email?: string }[]> } }>(
      IDENTITY_STORES,
    );
    const holders = await stores.users.listByRole('ProductionManager');

    const recipients = holders
      .map((holder) => holder.email)
      .filter((email): email is string => email !== undefined && email !== null)
      .sort();

    expect(recipients).toEqual(['pm-one@example.test', 'pm-two@example.test']);
  });
});

describe('Orders edge — the revenue category and tax treatment survive conversion', () => {
  it("copies the quote line's revenue category and tax treatment onto the order line", async () => {
    const quoteId = await createQuote(customerB);
    expect(
      (
        await sales.put(`/quoting/quotes/${quoteId}/lines`).send({
          lockVersion: await quoteLockVersion(quoteId),
          lines: [
            {
              ...plainLine,
              revenueCategory: 'label',
              taxTreatment: { taxStatus: 'wa_tax', taxJurisdiction: 'WA-9034' },

              deliveryAddress: {
                line1: '200 Example Way',
                city: 'Sample Harbor',
                state: 'WA',
                postalCode: '98000',
              },
            },
          ],
        })
      ).status,
    ).toBe(200);
    expect((await send(quoteId)).status).toBe(200);

    const orderId = await convert(quoteId);
    const order = await sales.get(`/orders/${orderId}`);

    expect(order.status).toBe(200);
    expect(order.body.lines[0]).toMatchObject({
      revenueCategory: 'label',
      taxStatus: 'wa_tax',
      taxJurisdiction: 'WA-9034',
    });
  });

  it('carries whether the line is printed onto the order line', async () => {
    const quoteId = await createQuote(customerB);
    expect(
      (
        await sales.put(`/quoting/quotes/${quoteId}/lines`).send({
          lockVersion: await quoteLockVersion(quoteId),
          lines: [{ ...plainLine, printed: true }],
        })
      ).status,
    ).toBe(200);
    expect((await send(quoteId)).status).toBe(200);

    const orderId = await convert(quoteId);
    const order = await sales.get(`/orders/${orderId}`);

    expect(order.status).toBe(200);
    expect(order.body.lines[0]).toMatchObject({ printed: true });
  });

  it("carries the customer's part number and description onto the order line", async () => {
    const quoteId = await createQuote(customerB);
    expect(
      (
        await sales.put(`/quoting/quotes/${quoteId}/lines`).send({
          lockVersion: await quoteLockVersion(quoteId),
          lines: [
            {
              ...plainLine,
              customerPartNumber: 'LN-1300-C',
              customerDescription: 'CEDAR CORE SHEET',
            },
            plainLine,
          ],
        })
      ).status,
    ).toBe(200);
    expect((await send(quoteId)).status).toBe(200);

    const orderId = await convert(quoteId);
    const order = await sales.get(`/orders/${orderId}`);

    expect(order.status).toBe(200);
    expect(order.body.lines[0]).toMatchObject({
      customerPartNumber: 'LN-1300-C',
      customerDescription: 'CEDAR CORE SHEET',
    });
    expect(order.body.lines[1]).not.toHaveProperty('customerPartNumber');
    expect(order.body.lines[1]).not.toHaveProperty('customerDescription');
  });

  it('defaults a line to not printed rather than guessing from the print cost', async () => {
    const quoteId = await createQuote(customerB);
    expect(
      (
        await sales.put(`/quoting/quotes/${quoteId}/lines`).send({
          lockVersion: await quoteLockVersion(quoteId),

          lines: [{ ...plainLine, printCostPerTon: '120.0000' }],
        })
      ).status,
    ).toBe(200);

    const quote = await sales.get(`/quoting/quotes/${quoteId}`);

    expect(quote.status).toBe(200);
    expect(quote.body.lines[0]).toMatchObject({ printed: false });
  });

  it('refuses a taxable line that names no jurisdiction', async () => {
    const quoteId = await createQuote(customerB);

    const response = await sales.put(`/quoting/quotes/${quoteId}/lines`).send({
      lockVersion: await quoteLockVersion(quoteId),
      lines: [{ ...plainLine, taxTreatment: { taxStatus: 'wa_tax' } }],
    });

    expect(response.status).toBe(400);
  });

  it('refuses a non-taxable line that names a jurisdiction anyway', async () => {
    const quoteId = await createQuote(customerB);

    const response = await sales.put(`/quoting/quotes/${quoteId}/lines`).send({
      lockVersion: await quoteLockVersion(quoteId),
      lines: [{ ...plainLine, taxTreatment: { taxStatus: 'non_tax', taxJurisdiction: 'ID' } }],
    });

    expect(response.status).toBe(400);
  });
});

describe('Orders edge — a ProductionManager is not locked out of the floor', () => {
  let pmSeq = 0;

  async function readyToConfirm(): Promise<string> {
    pmSeq += 1;
    const orderId = await convert(await quotedQuote(customerB));
    await fileFullPurchaseOrder(orderId, {
      poNumber: `PO-PM-${String(pmSeq)}`,
      lines: [{ lineNumber: 1, paper: 'kraft', poundage: '37.0000', rolls: 10 }],
    });
    return orderId;
  }

  it('confirms an order — the act reserved for the Production Manager', async () => {
    const orderId = await readyToConfirm();

    const response = await productionManager
      .post(`/orders/${orderId}/confirm`)
      .send({ lockVersion: await lockVersionOf(orderId), confirmedLeadTimeDays: 7 });

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('confirmed');
  });

  it('issues the order confirmation', async () => {
    const orderId = await readyToConfirm();
    expect(
      (
        await productionManager
          .post(`/orders/${orderId}/confirm`)
          .send({ lockVersion: await lockVersionOf(orderId), confirmedLeadTimeDays: 7 })
      ).status,
    ).toBe(200);

    const response = await productionManager.post(`/orders/${orderId}/confirmation`);

    expect(response.status).not.toBe(403);
  });
});
