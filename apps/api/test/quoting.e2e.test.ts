// End-to-end over HTTP: the quote routes from creation to send, the decisions on a send, the role gates and the error mapping.
import { DEV_USERNAMES } from '@erp/identity';
import {
  InMemoryMailSink,
  InMemorySendLog,
  consoleMailLog,
  systemClock,
  type MailLog,
} from '@erp/notifications';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { applyRequestParsing } from '../src/config/request-parsing';
import request from 'supertest';
import { inflateSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { MAIL_CONTACT_ROLES, roundToCents } from '@erp/types';
import type { QuotingStores } from '../src/quoting/quoting.factory';

import { FAILURE_NOTICE_ACTOR } from '@erp/types';
import { formatQuoteNumber } from '@erp/types';

import { DocumentService, DEMO_BRAND } from '@erp/documents';

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

const KRAFT_37_ID = 'grade-kraft-37';

const WEIGHTLESS_GRADE_ID = 'grade-kraft-weightless';

let app: INestApplication;
let sales: request.Agent;
let billing: request.Agent;
let production: request.Agent;
let noroles: request.Agent;

let customerId: string;

let quotingStores: QuotingStores;
let mail: InMemoryMailSink;
let sendLog: InMemorySendLog;

// Every line the API logs, kept for the assertions and still written to the console.
const logged: Record<string, unknown>[] = [];
const recordingLog: MailLog = {
  info: (line) => {
    logged.push(line);
    consoleMailLog.info(line);
  },
  warn: (line) => {
    logged.push(line);
    consoleMailLog.warn(line);
  },
  error: (line) => {
    logged.push(line);
    consoleMailLog.error(line);
  },
};

// The text runs a rendered PDF shows, in page order. The renderer deflates each page's content
// stream and writes each run as hex-encoded WinAnsi.
function pdfTextRuns(bytes: Uint8Array): string[] {
  const buffer = Buffer.from(bytes);
  const pdf = buffer.toString('latin1');
  const ids = [...pdf.matchAll(/\/Contents\s+(\d+)\s+0\s+R/g)].map((match) => match[1] as string);
  return ids.flatMap((id) => {
    const start = pdf.indexOf(`\n${id} 0 obj`);
    const streamAt = pdf.indexOf('stream', start) + 'stream'.length;
    const dataAt = pdf[streamAt] === '\r' ? streamAt + 2 : streamAt + 1;
    const content = inflateSync(buffer.subarray(dataAt, pdf.indexOf('endstream', dataAt))).toString(
      'latin1',
    );
    return [...content.matchAll(/\[([^\]]*)\]\s*TJ|<([0-9a-fA-F]*)>\s*Tj/g)].map((match) =>
      [...(match[1] ?? `<${match[2] ?? ''}>`).matchAll(/<([0-9a-fA-F]*)>/g)]
        .map((hex) => Buffer.from(hex[1] ?? '', 'hex').toString('latin1'))
        .join(''),
    );
  });
}

async function loginAgent(username: string, password: string): Promise<request.Agent> {
  const agent = request.agent(app.getHttpServer());
  const response = await agent.post('/auth/login').send({ username, password });
  expect(response.status).toBe(200);
  return agent;
}

function http(): request.Agent {
  return request(app.getHttpServer());
}

const plainLine = {
  gradeId: KRAFT_37_ID,
  footageVariant: 'long',
  rollWidthIn: 12,
  quantityRolls: 10,

  taxTreatment: { taxStatus: 'id_tax', taxJurisdiction: 'ID' },
};

async function createQuote(agent: request.Agent): Promise<string> {
  const created = await agent.post('/quoting/quotes').send({ customerId });
  expect(created.status).toBe(201);
  return created.body.id as string;
}

async function lockVersionOf(quoteId: string): Promise<number> {
  const current = await sales.get(`/quoting/quotes/${quoteId}`);
  expect(current.status).toBe(200);
  return current.body.lockVersion as number;
}

async function setLeadTime(quoteId: string, leadTimeDays = 10): Promise<void> {
  const response = await production
    .put(`/quoting/quotes/${quoteId}/lead-time`)
    .send({ leadTimeDays, lockVersion: await lockVersionOf(quoteId) });
  expect(response.status).toBe(200);
}

async function putLines(
  agent: request.Agent,
  quoteId: string,
  lines: readonly Record<string, unknown>[],

  lockVersion?: number,
): Promise<request.Response> {
  return agent
    .put(`/quoting/quotes/${quoteId}/lines`)
    .send({ lines, lockVersion: lockVersion ?? (await lockVersionOf(quoteId)) });
}

beforeAll(async () => {
  const { AuthModule } = await import('../src/auth/auth.module');
  const { AdminModule } = await import('../src/admin/admin.module');
  const { CrmModule } = await import('../src/crm/crm.module');
  const { QuotingModule } = await import('../src/quoting/quoting.module');
  const { QUOTING_STORES } = await import('../src/quoting/quoting.factory');
  const { MAIL_LOG, MAIL_SINK, SEND_LOG } =
    await import('../src/notifications/notifications.factory');

  mail = new InMemoryMailSink(systemClock);

  sendLog = new InMemorySendLog();
  const moduleRef = await Test.createTestingModule({
    imports: [AuthModule, AdminModule, CrmModule, QuotingModule],
  })
    .overrideProvider(MAIL_SINK)
    .useValue(mail)
    .overrideProvider(SEND_LOG)
    .useValue(sendLog)
    .overrideProvider(MAIL_LOG)
    .useValue(recordingLog)
    .compile();
  app = moduleRef.createNestApplication();
  applyRequestParsing(app);
  app.use(cookieParser());
  await app.listen(0, '127.0.0.1');

  const stores = moduleRef.get<QuotingStores>(QUOTING_STORES);
  quotingStores = stores;
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

  await stores.grades.create({
    id: WEIGHTLESS_GRADE_ID,
    productFamily: 'kraft',
    code: '0#',
    basisWeightLb: '0.0000',
    reamAreaDivisor: '432.0000',
    paperCostPerTonne: '900.0000',
    footages: [{ variant: 'long', label: 'Long roll', feetPerRoll: '1000.0000' }],
    createdAt: now,
    updatedAt: now,

    widths: (await stores.palletFits.list('kraft')).map(({ rollWidthIn, rollsPerPallet }) => ({
      rollWidthIn,
      rollsPerPallet,
    })),
  });

  const admin = await loginAgent('break-glass', BREAK_GLASS_PASSWORD);
  for (const [username, roles] of [
    ['dev-sales', ['Sales']],
    ['dev-billing', ['Billing']],

    ['dev-production', ['Production']],
  ] as const) {
    const grant = await admin.put(`/admin/users/local:${username}/roles`).send({
      identity: { externalId: `local:${username}`, username, displayName: username },
      roles,
    });
    expect(grant.status).toBe(200);
  }

  sales = await loginAgent('dev-sales', DEV_PASSWORD);
  billing = await loginAgent('dev-billing', DEV_PASSWORD);
  production = await loginAgent('dev-production', DEV_PASSWORD);
  noroles = await loginAgent('dev-noroles', DEV_PASSWORD);

  const customer = await sales.post('/crm/customers').send({
    billingAddress: QUOTABLE_BILLING_ADDRESS,
    name: 'Quoting E2E Paper Co',
    legacyAccountNumber: 'LA-Q-1',
  });
  expect(customer.status).toBe(201);
  customerId = customer.body.id;
});

afterAll(async () => {
  await app.close();
});

describe('Quoting edge — authentication', () => {
  it('rejects an anonymous request on every route', async () => {
    expect((await http().get('/quoting/grades')).status).toBe(401);
    expect((await http().get('/quoting/pallet-fits').query({ family: 'kraft' })).status).toBe(401);
    expect((await http().get('/quoting/tiers')).status).toBe(401);
    expect((await http().get('/quoting/config')).status).toBe(401);
    expect((await http().post('/quoting/quotes').send({ customerId: 'x' })).status).toBe(401);
    expect((await http().get('/quoting/quotes')).status).toBe(401);
    expect((await http().get('/quoting/quotes/00000000-0000-4000-8000-000000000000')).status).toBe(
      401,
    );
    expect(
      (
        await http()
          .put('/quoting/quotes/00000000-0000-4000-8000-000000000000/lines')
          .send({ lines: [] })
      ).status,
    ).toBe(401);
    expect(
      (
        await http()
          .post('/quoting/quotes/00000000-0000-4000-8000-000000000000/transition')
          .send({ to: 'quoted', lockVersion: 1 })
      ).status,
    ).toBe(401);
    expect(
      (await http().get('/quoting/quotes/00000000-0000-4000-8000-000000000000/sendability')).status,
    ).toBe(401);
    expect(
      (await http().get('/quoting/quotes/00000000-0000-4000-8000-000000000000/totals')).status,
    ).toBe(401);
    expect(
      (await http().get('/quoting/quotes/00000000-0000-4000-8000-000000000000/versions')).status,
    ).toBe(401);
    expect(
      (await http().post('/quoting/quotes/00000000-0000-4000-8000-000000000000/revise').send({}))
        .status,
    ).toBe(401);
    expect(
      (
        await http()
          .post('/quoting/quotes/00000000-0000-4000-8000-000000000000/override/approve')
          .send({})
      ).status,
    ).toBe(401);
    expect(
      (
        await http()
          .post('/quoting/quotes/00000000-0000-4000-8000-000000000000/override/reject')
          .send({ reason: 'y' })
      ).status,
    ).toBe(401);
    expect(
      (await http().get('/quoting/quotes/00000000-0000-4000-8000-000000000000/override/decisions'))
        .status,
    ).toBe(401);
  });
});

describe('Quoting edge — authorization', () => {
  it('serves the catalog to any signed-in user, roles or none', async () => {
    expect((await noroles.get('/quoting/grades')).status).toBe(200);
    expect((await noroles.get('/quoting/tiers')).status).toBe(200);
    expect((await noroles.get('/quoting/config')).status).toBe(200);
    expect((await noroles.get('/quoting/quotes')).status).toBe(200);
  });

  it('denies quote writes to a signed-in user without Sales or Admin', async () => {
    expect((await noroles.post('/quoting/quotes').send({ customerId })).status).toBe(403);
    expect((await billing.post('/quoting/quotes').send({ customerId })).status).toBe(403);
  });

  it('lets Sales save lines and refuses Billing (role sets are per route)', async () => {
    const quoteId = await createQuote(sales);
    expect((await putLines(billing, quoteId, [plainLine])).status).toBe(403);
    expect((await putLines(sales, quoteId, [plainLine])).status).toBe(200);
  });

  it('lets Billing decide overrides and refuses Sales (never their own)', async () => {
    const quoteId = await createQuote(sales);
    expect((await sales.post(`/quoting/quotes/${quoteId}/override/approve`).send({})).status).toBe(
      403,
    );
    expect(
      (await sales.post(`/quoting/quotes/${quoteId}/override/reject`).send({ reason: 'no' }))
        .status,
    ).toBe(403);

    expect(
      (
        await billing
          .post(`/quoting/quotes/${quoteId}/override/approve`)
          .send({ lockVersion: await lockVersionOf(quoteId) })
      ).status,
    ).toBe(409);
  });
});

describe('Quoting edge — catalog', () => {
  it('lists grades, optionally filtered by family, and 400s an unknown family', async () => {
    const all = await sales.get('/quoting/grades');
    expect(all.status).toBe(200);
    expect(all.body.items.map((g: { id: string }) => g.id)).toContain(KRAFT_37_ID);

    const kraft = await sales.get('/quoting/grades').query({ family: 'kraft' });
    expect(kraft.status).toBe(200);
    expect(kraft.body.items.length).toBeGreaterThan(0);

    expect((await sales.get('/quoting/grades').query({ family: 'vellum' })).status).toBe(400);
  });

  it('requires a family on pallet-fits and serves the seeded steps', async () => {
    expect((await sales.get('/quoting/pallet-fits')).status).toBe(400);
    const fits = await sales.get('/quoting/pallet-fits').query({ family: 'kraft' });
    expect(fits.status).toBe(200);
    expect(fits.body.items.length).toBeGreaterThan(0);
    expect(fits.body.items[0].productFamily).toBe('kraft');
  });

  it('serves the tier table and the pricing config', async () => {
    const tiers = await sales.get('/quoting/tiers');
    expect(tiers.status).toBe(200);
    expect(tiers.body.items.length).toBeGreaterThan(0);

    const config = await sales.get('/quoting/config');
    expect(config.status).toBe(200);
    expect(config.body.marginFloorPct).toBe('0.120000');
  });
});

describe('Quoting edge — pricing a line per pound', () => {
  it('saves a per-pound line and returns both new figures', async () => {
    const quoteId = await createQuote(sales);

    const saved = await putLines(sales, quoteId, [
      { ...plainLine, pricingBasis: 'per_pound', orderedWeightLb: '1000.0000' },
    ]);
    expect(saved.status).toBe(200);
    const line = saved.body.lines[0];

    expect(line.pricingBasis).toBe('per_pound');
    expect(Number(line.productPricePerLb)).toBeGreaterThan(0);

    expect(Number(line.productPricePerLb)).toBeLessThanOrEqual(Number(line.pricePerLb));

    expect(line.quantityRolls).toBe(10);
    expect(line.orderedWeightLb).toBe('1000.0000');
    expect(Number(line.extendedPrice)).toBeCloseTo(Number(line.productPricePerLb) * 1000, 4);

    const fetched = await sales.get(`/quoting/quotes/${quoteId}`);
    expect(fetched.status).toBe(200);
    expect(fetched.body.lines[0].productPricePerLb).toBe(line.productPricePerLb);
    expect(fetched.body.lines[0].pricingBasis).toBe('per_pound');
    expect(fetched.body.lines[0].orderedWeightLb).toBe('1000.0000');
  });

  it('refuses 422 a per-pound line with no pounds ordered, naming the line', async () => {
    const quoteId = await createQuote(sales);

    const refused = await putLines(sales, quoteId, [
      plainLine,
      { ...plainLine, pricingBasis: 'per_pound' },
    ]);

    expect(refused.status).toBe(422);
    expect(refused.body.reason).toBe('per-pound-needs-ordered-weight');
    expect(refused.body.value).toMatchObject({ lineNumber: 2 });

    const fetched = await sales.get(`/quoting/quotes/${quoteId}`);
    expect(fetched.body.lines).toHaveLength(0);
  });

  it('refuses 422 pounds ordered on a per-roll line', async () => {
    const quoteId = await createQuote(sales);

    const refused = await putLines(sales, quoteId, [
      { ...plainLine, orderedWeightLb: '1000.0000' },
    ]);

    expect(refused.status).toBe(422);
    expect(refused.body.reason).toBe('per-roll-ordered-weight');
    expect(refused.body.value).toMatchObject({ lineNumber: 1 });
  });

  it('refuses 400 pounds ordered of zero, before pricing', async () => {
    const quoteId = await createQuote(sales);

    const refused = await putLines(sales, quoteId, [
      { ...plainLine, pricingBasis: 'per_pound', orderedWeightLb: '0' },
    ]);

    expect(refused.status).toBe(400);
  });

  it('defaults an unstated basis to per_roll and carries no price per pound', async () => {
    const quoteId = await createQuote(sales);

    const saved = await putLines(sales, quoteId, [plainLine]);
    expect(saved.status).toBe(200);
    expect(saved.body.lines[0].pricingBasis).toBe('per_roll');
    expect(saved.body.lines[0].productPricePerLb).toBeUndefined();
  });

  it('refuses 422 when a per-pound line has no roll weight, naming the line', async () => {
    const quoteId = await createQuote(sales);

    const refused = await putLines(sales, quoteId, [
      plainLine,
      {
        ...plainLine,
        gradeId: WEIGHTLESS_GRADE_ID,
        pricingBasis: 'per_pound',
        orderedWeightLb: '1000.0000',
      },
    ]);

    expect(refused.status).toBe(422);
    expect(refused.body.reason).toBe('per-pound-needs-roll-weight');
    expect(refused.body.value).toMatchObject({ lineNumber: 2, gradeId: WEIGHTLESS_GRADE_ID });

    const fetched = await sales.get(`/quoting/quotes/${quoteId}`);
    expect(fetched.body.lines).toHaveLength(0);
  });

  it('refuses 422 a per-pound line that also carries a hand-set price', async () => {
    const quoteId = await createQuote(sales);

    const refused = await putLines(sales, quoteId, [
      { ...plainLine, pricingBasis: 'per_pound', overridePricePerRoll: '14.7500' },
    ]);

    expect(refused.status).toBe(422);
    expect(refused.body.reason).toBe('per-pound-hand-set-price');
    expect(refused.body.value).toMatchObject({ lineNumber: 1 });

    const fetched = await sales.get(`/quoting/quotes/${quoteId}`);
    expect(fetched.body.lines).toHaveLength(0);
  });

  it('saves a margin entered manually, priced from cost, with no approval', async () => {
    const quoteId = await createQuote(sales);

    const saved = await putLines(sales, quoteId, [{ ...plainLine, marginOverridePct: '0.365000' }]);

    expect(saved.status).toBe(200);
    expect(saved.body.lines[0]).toMatchObject({
      priceSource: 'margin',
      marginOverridePct: '0.365000',
      marginPct: '0.365000',
      floor: { status: 'ok' },
    });
    expect(saved.body.lines[0].marginPricePerRoll).toBe(saved.body.lines[0].pricePerRoll);
    expect(saved.body.status).toBe('draft');
  });

  it('refuses 422 a margin entered manually under the floor, naming the line and the floor', async () => {
    const quoteId = await createQuote(sales);

    const refused = await putLines(sales, quoteId, [
      plainLine,
      { ...plainLine, marginOverridePct: '0.075000' },
    ]);

    expect(refused.status).toBe(422);
    expect(refused.body.reason).toBe('entered-margin-below-floor');
    expect(refused.body.value).toEqual({
      lineNumber: 2,
      marginOverridePct: '0.075000',
      floorPct: '0.120000',
    });

    const fetched = await sales.get(`/quoting/quotes/${quoteId}`);
    expect(fetched.body.lines).toHaveLength(0);
  });

  it('refuses 422 a margin entered manually beside a hand-set price or a forced tier', async () => {
    const quoteId = await createQuote(sales);

    const handSet = await putLines(sales, quoteId, [
      { ...plainLine, marginOverridePct: '0.365000', overridePricePerRoll: '64.0000' },
    ]);
    expect(handSet.status).toBe(422);
    expect(handSet.body.reason).toBe('entered-margin-hand-set-price');
    expect(handSet.body.value).toMatchObject({ lineNumber: 1 });

    const forced = await putLines(sales, quoteId, [
      { ...plainLine, marginOverridePct: '0.365000', tierOverrideCode: 'volume_5' },
    ]);
    expect(forced.status).toBe(422);
    expect(forced.body.reason).toBe('entered-margin-tier-override');

    const over = await putLines(sales, quoteId, [{ ...plainLine, marginOverridePct: '0.975000' }]);
    expect(over.status).toBe(400);
    const fine = await putLines(sales, quoteId, [{ ...plainLine, marginOverridePct: '0.412700' }]);
    expect(fine.status).toBe(400);
  });
});

describe('Quoting edge — the happy path', () => {
  it('creates, prices, reloads and sends a quote end-to-end', async () => {
    const created = await sales.post('/quoting/quotes').send({ customerId, notes: 'rush job' });
    expect(created.status).toBe(201);
    expect(created.body.status).toBe('draft');
    expect(created.body.versionNumber).toBe(1);
    const quoteId = created.body.id as string;

    const saved = await putLines(sales, quoteId, [plainLine]);
    expect(saved.status).toBe(200);
    expect(saved.body.lines).toHaveLength(1);
    const line = saved.body.lines[0];
    expect(line.lineNumber).toBe(1);
    expect(line.priceSource).toBe('tier');
    expect(line.floor.status).toBe('ok');
    expect(Number(line.pricePerRoll)).toBeGreaterThan(0);

    const fetched = await sales.get(`/quoting/quotes/${quoteId}`);
    expect(fetched.status).toBe(200);
    expect(fetched.body.lines[0].pricePerRoll).toBe(line.pricePerRoll);

    const totals = await sales.get(`/quoting/quotes/${quoteId}/totals`);
    expect(totals.status).toBe(200);

    expect(totals.body.extendedPrice).toBe(roundToCents(line.extendedPrice));

    const sendability = await sales.get(`/quoting/quotes/${quoteId}/sendability`);
    expect(sendability.status).toBe(200);
    expect(sendability.body).toEqual({ sendable: true });

    await setLeadTime(quoteId);

    await setLeadTime(quoteId);

    const sent = await sales
      .post(`/quoting/quotes/${quoteId}/transition`)
      .send({ to: 'quoted', lockVersion: await lockVersionOf(quoteId) });
    expect(sent.status).toBe(200);
    expect(sent.body.status).toBe('quoted');

    const listed = await billing.get('/quoting/quotes').query({ status: 'quoted', customerId });
    expect(listed.status).toBe(200);
    expect(listed.body.items.map((q: { id: string }) => q.id)).toContain(quoteId);
  });

  it('400s a list filter naming an unknown status', async () => {
    expect((await sales.get('/quoting/quotes').query({ status: 'bogus' })).status).toBe(400);
  });

  it('filters by sales rep, exactly, and composes with the other filters', async () => {
    const janes = await sales.post('/quoting/quotes').send({ customerId, salesRep: 'jsmith' });
    expect(janes.status).toBe(201);
    const rowans = await sales.post('/quoting/quotes').send({ customerId, salesRep: 'rlee' });
    expect(rowans.status).toBe(201);
    const janesId = janes.body.id as string;

    const filtered = await sales.get('/quoting/quotes').query({ salesRep: 'jsmith' });
    expect(filtered.status).toBe(200);
    const ids = filtered.body.items.map((q: { id: string }) => q.id) as string[];
    expect(ids).toContain(janesId);
    expect(ids).not.toContain(rowans.body.id as string);

    const prefix = await sales.get('/quoting/quotes').query({ salesRep: 'jsmit' });
    expect(prefix.body.items).toEqual([]);

    const withStatus = await sales
      .get('/quoting/quotes')
      .query({ salesRep: 'jsmith', status: 'quoted', customerId });
    expect((withStatus.body.items as { id: string }[]).map((q) => q.id)).not.toContain(janesId);
  });

  it('400s an empty or repeated salesRep rather than reading it as no filter', async () => {
    expect((await sales.get('/quoting/quotes?salesRep=')).status).toBe(400);
    expect((await sales.get('/quoting/quotes?salesRep=%20')).status).toBe(400);
    expect((await sales.get('/quoting/quotes?salesRep=jsmith&salesRep=rlee')).status).toBe(400);
  });

  it('numbers a new quote and finds it by that number', async () => {
    const first = await sales.post('/quoting/quotes').send({ customerId });
    const second = await sales.post('/quoting/quotes').send({ customerId });
    expect(first.status).toBe(201);
    expect(second.body.quoteNumber).toBeGreaterThan(first.body.quoteNumber as number);

    const found = await sales
      .get('/quoting/quotes')
      .query({ quoteNumber: String(first.body.quoteNumber) });
    expect(found.status).toBe(200);
    expect(found.body.items.map((q: { id: string }) => q.id)).toEqual([first.body.id]);
  });

  it('400s a quote number that is not a counter', async () => {
    for (const bad of ['', 'Q-04126', '0', '-1', '3.7', 'abc']) {
      const response = await sales.get('/quoting/quotes').query({ quoteNumber: bad });
      expect(response.status, bad).toBe(400);
      expect(response.body.reason, bad).toBe('invalid-quote-number');
    }
    const repeated = await sales.get('/quoting/quotes?quoteNumber=1&quoteNumber=2');
    expect(repeated.status).toBe(400);
  });

  it('lists the quotes with no lead time, beside the status and the customer', async () => {
    const waiting = await sales.post('/quoting/quotes').send({ customerId });
    const entered = await sales.post('/quoting/quotes').send({ customerId });
    expect(waiting.status).toBe(201);
    await setLeadTime(entered.body.id as string, 0);

    const missing = await production
      .get('/quoting/quotes')
      .query({ leadTime: 'missing', status: 'draft', customerId });
    expect(missing.status).toBe(200);
    const ids = missing.body.items.map((q: { id: string }) => q.id) as string[];
    expect(ids).toContain(waiting.body.id);

    expect(ids).not.toContain(entered.body.id);

    const quoted = await production
      .get('/quoting/quotes')
      .query({ leadTime: 'missing', status: 'quoted', customerId });
    expect((quoted.body.items as { id: string }[]).map((q) => q.id)).not.toContain(waiting.body.id);
  });

  it('carries each listed quote its line summary', async () => {
    const created = await sales.post('/quoting/quotes').send({ customerId });
    const listed = await sales.get('/quoting/quotes').query({ customerId });
    const item = (listed.body.items as { id: string }[]).find((q) => q.id === created.body.id);
    expect(item).toMatchObject({
      lineCount: 0,
      belowFloorCount: 0,
      manualCount: 0,
      manualPricePerRoll: null,
    });
  });

  it('400s a lead-time filter other than missing', async () => {
    for (const bad of ['', 'present', 'MISSING', 'entered']) {
      const response = await sales.get('/quoting/quotes').query({ leadTime: bad });
      expect(response.status, bad).toBe(400);
      expect(response.body.reason, bad).toBe('invalid-lead-time-filter');
    }
    const repeated = await sales.get('/quoting/quotes?leadTime=missing&leadTime=missing');
    expect(repeated.status).toBe(400);
    expect(repeated.body.reason).toBe('invalid-lead-time-filter');
  });

  it('lists the quotes of any of several customers', async () => {
    const other = await sales
      .post('/crm/customers')
      .send({ billingAddress: QUOTABLE_BILLING_ADDRESS, name: 'Several Customers Co' });
    expect(other.status).toBe(201);
    const otherId = other.body.id as string;
    const mine = await sales.post('/quoting/quotes').send({ customerId });
    const theirs = await sales.post('/quoting/quotes').send({ customerId: otherId });

    const both = await sales.get(`/quoting/quotes?customerId=${customerId}&customerId=${otherId}`);
    expect(both.status).toBe(200);
    const ids = both.body.items.map((q: { id: string }) => q.id) as string[];
    expect(ids).toContain(mine.body.id);
    expect(ids).toContain(theirs.body.id);

    const one = await sales.get(`/quoting/quotes?customerId=${otherId}`);
    expect(one.body.items.map((q: { id: string }) => q.id)).toEqual([theirs.body.id]);

    const empty = await sales.get(`/quoting/quotes?customerId=${customerId}&customerId=`);
    expect(empty.status).toBe(400);
    expect(empty.body.reason).toBe('empty-customer-id');
  });

  it('lists the quotes named by id, any of several', async () => {
    const a = await sales.post('/quoting/quotes').send({ customerId });
    const b = await sales.post('/quoting/quotes').send({ customerId });
    const c = await sales.post('/quoting/quotes').send({ customerId });
    expect(c.status).toBe(201);

    const two = await sales.get(`/quoting/quotes?id=${a.body.id}&id=${b.body.id}`);
    expect(two.status).toBe(200);
    const ids = (two.body.items as { id: string }[]).map((q) => q.id);
    expect(ids.sort()).toEqual([a.body.id as string, b.body.id as string].sort());
    expect(ids).not.toContain(c.body.id);

    const empty = await sales.get(`/quoting/quotes?id=${a.body.id}&id=`);
    expect(empty.status).toBe(400);
    expect(empty.body.reason).toBe('empty-quote-id');

    const counted = await sales.get(`/quoting/quotes?id=${a.body.id}&count=true`);
    expect(counted.status).toBe(200);
    expect(counted.body.count).toBe(1);
  });

  it('answers count=true with the count and the oldest, under the list filters', async () => {
    const other = await sales
      .post('/crm/customers')
      .send({ billingAddress: QUOTABLE_BILLING_ADDRESS, name: 'Queue Count Co' });
    const otherId = other.body.id as string;
    const first = await sales.post('/quoting/quotes').send({ customerId: otherId });
    const second = await sales.post('/quoting/quotes').send({ customerId: otherId });
    expect(second.status).toBe(201);

    const listed = await production.get('/quoting/quotes').query({ customerId: otherId });
    const counted = await production
      .get('/quoting/quotes')
      .query({ customerId: otherId, count: 'true' });
    expect(counted.status).toBe(200);
    expect(counted.body).not.toHaveProperty('items');
    expect(counted.body.count).toBe(listed.body.items.length);
    expect(counted.body.count).toBe(2);

    expect(Object.keys(counted.body.oldest).sort()).toEqual(
      ['customerId', 'id', 'quoteNumber', 'status', 'updatedAt', 'versionNumber'].sort(),
    );
    expect(counted.body.oldest.id).toBe(first.body.id);

    const none = await production
      .get('/quoting/quotes')
      .query({ customerId: otherId, status: 'quoted', count: 'true' });
    expect(none.body).toEqual({ count: 0, oldest: null });

    const asList = await production
      .get('/quoting/quotes')
      .query({ customerId: otherId, count: 'false' });
    expect(asList.body.items).toHaveLength(2);
  });

  it('sorts by updatedAt and cuts the limit after the sort', async () => {
    const other = await sales
      .post('/crm/customers')
      .send({ billingAddress: QUOTABLE_BILLING_ADDRESS, name: 'Queue Sort Co' });
    const otherId = other.body.id as string;
    const first = await sales.post('/quoting/quotes').send({ customerId: otherId });
    const second = await sales.post('/quoting/quotes').send({ customerId: otherId });

    const oldest = await sales
      .get('/quoting/quotes')
      .query({ customerId: otherId, sort: 'oldest', limit: '1' });
    expect(oldest.status).toBe(200);
    expect(oldest.body.items.map((q: { id: string }) => q.id)).toEqual([first.body.id]);
    const newest = await sales
      .get('/quoting/quotes')
      .query({ customerId: otherId, sort: 'newest' });
    expect(newest.body.items.map((q: { id: string }) => q.id)).toEqual([
      second.body.id,
      first.body.id,
    ]);
  });

  it('400s a count, limit or sort it cannot read', async () => {
    const cases: [Record<string, string>, string][] = [
      [{ count: 'yes' }, 'invalid-count'],
      [{ count: '' }, 'invalid-count'],
      [{ count: 'true', limit: '5' }, 'invalid-count-query'],
      [{ count: 'true', sort: 'oldest' }, 'invalid-count-query'],
      [{ limit: '0' }, 'invalid-limit'],
      [{ limit: '201' }, 'invalid-limit'],
      [{ limit: '3.7' }, 'invalid-limit'],
      [{ limit: 'ten' }, 'invalid-limit'],
      [{ limit: '' }, 'invalid-limit'],
      [{ sort: 'updated' }, 'invalid-sort'],
      [{ sort: '' }, 'invalid-sort'],
    ];
    for (const [query, reason] of cases) {
      const response = await sales.get('/quoting/quotes').query(query);
      expect(response.status, JSON.stringify(query)).toBe(400);
      expect(response.body.reason, JSON.stringify(query)).toBe(reason);
    }
    const repeated = await sales.get('/quoting/quotes?limit=1&limit=2');
    expect(repeated.body.reason).toBe('invalid-limit');

    expect((await sales.get('/quoting/quotes').query({ limit: '200' })).status).toBe(200);
    expect((await sales.get('/quoting/quotes').query({ limit: '1' })).status).toBe(200);
  });
});

describe('PUT /quoting/quotes/:id/lines — the staleness guard', () => {
  it('refuses a save built on a generation the quote has left, and keeps both lines', async () => {
    const quoteId = await createQuote(sales);
    await putLines(sales, quoteId, [plainLine]);

    const asRead = await lockVersionOf(quoteId);

    const first = await putLines(sales, quoteId, [plainLine, { ...plainLine, quantityRolls: 6 }]);
    expect(first.status).toBe(200);
    expect(first.body.lines).toHaveLength(2);

    const stale = await putLines(sales, quoteId, [{ ...plainLine, quantityRolls: 9 }], asRead);
    expect(stale.status).toBe(409);
    expect(stale.body.reason).toBe('stale-aggregate');
    expect(stale.body.value.expected).toBe(asRead);
    expect(stale.body.value.actual).toBeGreaterThan(asRead);

    const after = await sales.get(`/quoting/quotes/${quoteId}`);
    expect(after.body.lines).toHaveLength(2);
    expect(after.body.lines[1].quantityRolls).toBe(6);
  });

  it('accepts the same save once the caller has re-read the quote', async () => {
    const quoteId = await createQuote(sales);
    await putLines(sales, quoteId, [plainLine]);
    const asRead = await lockVersionOf(quoteId);
    await putLines(sales, quoteId, [plainLine, { ...plainLine, quantityRolls: 6 }]);

    expect((await putLines(sales, quoteId, [plainLine], asRead)).status).toBe(409);
    expect((await putLines(sales, quoteId, [plainLine])).status).toBe(200);
  });

  it('requires the token — a whole-set write with no precondition is the defect', async () => {
    const quoteId = await createQuote(sales);
    const response = await sales
      .put(`/quoting/quotes/${quoteId}/lines`)
      .send({ lines: [plainLine] });
    expect(response.status).toBe(400);
  });

  it('takes the token as the string a form field posts', async () => {
    const quoteId = await createQuote(sales);
    const response = await sales
      .put(`/quoting/quotes/${quoteId}/lines`)
      .send({ lines: [plainLine], lockVersion: String(await lockVersionOf(quoteId)) });
    expect(response.status).toBe(200);
  });
});

describe('PUT /quoting/quotes/:id/lines — stock and custom widths', () => {
  it('refuses a width the paper is not stocked in, naming the line', async () => {
    const quoteId = await createQuote(sales);
    const response = await putLines(sales, quoteId, [plainLine, { ...plainLine, rollWidthIn: 17 }]);

    expect(response.status).toBe(422);
    expect(response.body.reason).toBe('width-not-stocked');
    expect(response.body.value).toEqual({ lineNumber: 2, rollWidthIn: 17 });
  });

  it('prices a custom width and stores the mark', async () => {
    const quoteId = await createQuote(sales);
    const response = await putLines(sales, quoteId, [
      { ...plainLine, rollWidthIn: 17, customWidth: true },
    ]);

    expect(response.status).toBe(200);
    expect(response.body.lines[0]).toMatchObject({ rollWidthIn: 17, customWidth: true });

    expect(response.body.lines[0].cost.rollsPerPallet).toBe(54);
  });

  it('refuses a custom width below every family step with the existing reason', async () => {
    const quoteId = await createQuote(sales);
    const response = await putLines(sales, quoteId, [
      { ...plainLine, rollWidthIn: 4, customWidth: true },
    ]);

    expect(response.status).toBe(422);
    expect(response.body.reason).toBe('no-pallet-fit-for-width');
  });

  it('refuses to retire a stock width a draft line uses', async () => {
    const created = await billing.post('/quoting/grades').send({
      productFamily: 'kraft',
      code: 'E2E 37# widths in use',
      basisWeightLb: '37.0000',
      paperCostPerTonne: '900.0000',
      footages: [{ variant: 'long', label: 'Long roll', feetPerRoll: '1000.0000' }],
      widths: [
        { rollWidthIn: 12, rollsPerPallet: 70 },
        { rollWidthIn: 24, rollsPerPallet: 40 },
      ],
    });
    expect(created.status).toBe(201);

    const quoteId = await createQuote(sales);
    expect(
      (await putLines(sales, quoteId, [{ ...plainLine, gradeId: created.body.id }])).status,
    ).toBe(200);

    const response = await billing.patch(`/quoting/grades/${created.body.id}`).send({
      widths: [{ rollWidthIn: 24, rollsPerPallet: 40 }],
      lockVersion: created.body.lockVersion,
    });
    expect(response.status).toBe(409);
    expect(response.body.reason).toBe('stock-width-in-use');
    expect(response.body.rollWidthIn).toBe(12);
    expect(response.body.lines).toEqual([{ quoteId, lineNumber: 1 }]);
  });
});

describe('PUT /quoting/quotes/:id/lines — a stock width in sixteenths', () => {
  async function wrapGrade(): Promise<string> {
    const created = await billing.post('/quoting/grades').send({
      productFamily: 'kraft',
      code: 'E2E 37# wrap widths',
      basisWeightLb: '37.0000',
      paperCostPerTonne: '900.0000',
      footages: [{ variant: 'long', label: 'Long roll', feetPerRoll: '1000.0000' }],
      widths: [{ rollWidthIn: 11.3125 }, { rollWidthIn: 24, rollsPerPallet: 40 }],
    });
    expect(created.status).toBe(201);
    return created.body.id as string;
  }

  it('prices a line at 11 5/16" per roll and per pound, off the exact width', async () => {
    const gradeId = await wrapGrade();
    const quoteId = await createQuote(sales);
    const response = await putLines(sales, quoteId, [
      { ...plainLine, gradeId, rollWidthIn: 11.3125 },
      {
        ...plainLine,
        gradeId,
        rollWidthIn: 11.3125,
        pricingBasis: 'per_pound',
        orderedWeightLb: '1000.0000',
      },
    ]);

    expect(response.status).toBe(200);
    const [perRoll, perPound] = response.body.lines;
    expect(perRoll).toMatchObject({ rollWidthIn: 11.3125, customWidth: false, pallets: null });

    expect(perRoll.cost.rollWeightLb).toBe('11.6267');
    expect(perPound).toMatchObject({ rollWidthIn: 11.3125, pricingBasis: 'per_pound' });
    expect(perPound.cost.rollWeightLb).toBe('11.6267');

    const fetched = await sales.get(`/quoting/quotes/${quoteId}`);
    expect(fetched.body.lines.map((line: { rollWidthIn: number }) => line.rollWidthIn)).toEqual([
      11.3125, 11.3125,
    ]);
  });

  it('refuses a width that is not a sixteenth, with the sentence', async () => {
    const quoteId = await createQuote(sales);
    const response = await putLines(sales, quoteId, [{ ...plainLine, rollWidthIn: 13.7 }]);

    expect(response.status).toBe(400);
    expect(JSON.stringify(response.body)).toContain(
      'a width is whole inches or sixteenths of an inch, from 1 to 1000 (11 5/16 is 11.3125)',
    );
  });

  it('refuses a custom width in sixteenths: the custom box is whole inches', async () => {
    const quoteId = await createQuote(sales);
    const response = await putLines(sales, quoteId, [
      { ...plainLine, rollWidthIn: 23.5, customWidth: true },
    ]);

    expect(response.status).toBe(400);
    expect(JSON.stringify(response.body)).toContain(
      'a custom width is a whole number of inches from 1 to 1000.',
    );
  });
});

describe('PUT /quoting/quotes/:id/lines - a negative cost per US ton', () => {
  it('refuses a negative converting or print cost, with the sentence, and saves nothing', async () => {
    const quoteId = await createQuote(sales);

    const convert = await putLines(sales, quoteId, [{ ...plainLine, convertCostPerTon: '-5' }]);
    expect(convert.status).toBe(400);
    expect(JSON.stringify(convert.body)).toContain('converting cost per US ton cannot be negative');

    const print = await putLines(sales, quoteId, [{ ...plainLine, printCostPerTon: '-0.09' }]);
    expect(print.status).toBe(400);
    expect(JSON.stringify(print.body)).toContain('print cost per US ton cannot be negative');

    const fetched = await sales.get(`/quoting/quotes/${quoteId}`);
    expect(fetched.body.lines).toHaveLength(0);
  });
});

describe('POST /quoting/quotes/:id/transition — the staleness guard', () => {
  async function drawnPage(): Promise<{ quoteId: string; asRead: number }> {
    const quoteId = await createQuote(sales);
    expect((await putLines(sales, quoteId, [plainLine])).status).toBe(200);
    return { quoteId, asRead: await lockVersionOf(quoteId) };
  }

  it('refuses a close-as-lost built on a generation the quote has left', async () => {
    const { quoteId, asRead } = await drawnPage();

    expect((await putLines(sales, quoteId, [{ ...plainLine, quantityRolls: 6 }])).status).toBe(200);

    const stale = await sales
      .post(`/quoting/quotes/${quoteId}/transition`)
      .send({ to: 'closed_lost', lockVersion: asRead });

    expect(stale.status).toBe(409);
    expect(stale.body.reason).toBe('stale-aggregate');
    expect(stale.body.value.expected).toBe(asRead);
    expect(stale.body.value.actual).toBeGreaterThan(asRead);

    expect((await sales.get(`/quoting/quotes/${quoteId}`)).body.status).toBe('draft');
  });

  it('refuses a price-approval request the same way', async () => {
    const { quoteId, asRead } = await drawnPage();
    expect((await putLines(sales, quoteId, [{ ...plainLine, quantityRolls: 7 }])).status).toBe(200);

    const stale = await sales
      .post(`/quoting/quotes/${quoteId}/transition`)
      .send({ to: 'override_requested', lockVersion: asRead });

    expect(stale.status).toBe(409);
    expect(stale.body.reason).toBe('stale-aggregate');

    expect((await sales.get(`/quoting/quotes/${quoteId}`)).body.status).toBe('draft');
  });

  it('accepts the same move once the caller has re-read the quote', async () => {
    const { quoteId, asRead } = await drawnPage();
    await putLines(sales, quoteId, [{ ...plainLine, quantityRolls: 6 }]);

    expect(
      (
        await sales
          .post(`/quoting/quotes/${quoteId}/transition`)
          .send({ to: 'closed_lost', lockVersion: asRead })
      ).status,
    ).toBe(409);
    expect(
      (
        await sales
          .post(`/quoting/quotes/${quoteId}/transition`)
          .send({ to: 'closed_lost', lockVersion: await lockVersionOf(quoteId) })
      ).status,
    ).toBe(200);
  });

  it('answers invalid-transition, not staleness, when the STATUS has moved on', async () => {
    const { quoteId, asRead } = await drawnPage();
    expect(
      (
        await sales
          .post(`/quoting/quotes/${quoteId}/transition`)
          .send({ to: 'override_requested', lockVersion: asRead })
      ).status,
    ).toBe(200);

    const again = await sales
      .post(`/quoting/quotes/${quoteId}/transition`)
      .send({ to: 'override_requested', lockVersion: asRead });

    expect(again.status).toBe(409);
    expect(again.body.reason).toBe('invalid-transition');
  });

  it('requires the token — a decision with no precondition is the defect', async () => {
    const quoteId = await createQuote(sales);
    const response = await sales
      .post(`/quoting/quotes/${quoteId}/transition`)
      .send({ to: 'closed_lost' });
    expect(response.status).toBe(400);
  });

  it('takes the token as the string a form field posts', async () => {
    const quoteId = await createQuote(sales);
    const response = await sales
      .post(`/quoting/quotes/${quoteId}/transition`)
      .send({ to: 'closed_lost', lockVersion: String(await lockVersionOf(quoteId)) });
    expect(response.status).toBe(200);
  });
});

describe('Quoting edge — pending mode-4 freight, one layer down', () => {
  it('round-trips a carrier line without a bid as pending, not free', async () => {
    const quoteId = await createQuote(sales);
    const saved = await putLines(sales, quoteId, [{ ...plainLine, freight: { mode: 'carrier' } }]);
    expect(saved.status).toBe(200);

    const fetched = await sales.get(`/quoting/quotes/${quoteId}`);
    expect(fetched.status).toBe(200);
    const freightResult = fetched.body.lines[0].freightResult;
    expect(freightResult.pending).toBe(true);
    expect(freightResult.cost).toBe('0.0000');
    expect(freightResult.margin).toBe('0.0000');
    expect(freightResult.invoiceTotal).toBe('0.0000');
  });
});

describe('Quoting edge — the floor holds without an Admin override', () => {
  it('saves a below-floor line but refuses to send it, with the stored verdict', async () => {
    const quoteId = await createQuote(sales);

    const saved = await putLines(sales, quoteId, [
      { ...plainLine, overridePricePerRoll: '2.4000' },
    ]);
    expect(saved.status).toBe(200);
    expect(saved.body.lines[0].floor.status).toBe('below_floor');

    const sendability = await sales.get(`/quoting/quotes/${quoteId}/sendability`);
    expect(sendability.status).toBe(200);
    expect(sendability.body.sendable).toBe(false);
    expect(sendability.body.belowFloor).toHaveLength(1);
    expect(sendability.body.belowFloor[0].lineNumber).toBe(1);
    expect(Number(sendability.body.belowFloor[0].minimumPricePerRoll)).toBeGreaterThan(2.4);

    await setLeadTime(quoteId);

    await setLeadTime(quoteId);

    const sent = await sales
      .post(`/quoting/quotes/${quoteId}/transition`)
      .send({ to: 'quoted', lockVersion: await lockVersionOf(quoteId) });
    expect(sent.status).toBe(409);
    expect(sent.body.reason).toBe('below-floor');
    expect(sent.body.value[0].lineNumber).toBe(1);
  });
});

describe('Quoting edge — hand-set price approval', () => {
  it('walks request → approve → edit-revokes → blocked again', async () => {
    const quoteId = await createQuote(sales);

    const handSet = { ...plainLine, overridePricePerRoll: '12.0000' };
    const saved = await putLines(sales, quoteId, [handSet]);
    expect(saved.status).toBe(200);
    expect(saved.body.lines[0].priceSource).toBe('manual');
    expect(saved.body.lines[0].floor.status).toBe('ok');

    await setLeadTime(quoteId);
    const unapproved = await sales
      .post(`/quoting/quotes/${quoteId}/transition`)
      .send({ to: 'quoted', lockVersion: await lockVersionOf(quoteId) });
    expect(unapproved.status).toBe(409);
    expect(unapproved.body.reason).toBe('override-not-approved');

    const requested = await sales
      .post(`/quoting/quotes/${quoteId}/transition`)
      .send({ to: 'override_requested', lockVersion: await lockVersionOf(quoteId) });
    expect(requested.status).toBe(200);

    const approved = await billing
      .post(`/quoting/quotes/${quoteId}/override/approve`)
      .send({ lockVersion: await lockVersionOf(quoteId) });
    expect(approved.status).toBe(200);
    expect(approved.body.overrideApprovedBy).toBe('dev-billing');

    const edited = await putLines(sales, quoteId, [{ ...handSet, overridePricePerRoll: '7.9500' }]);
    expect(edited.status).toBe(200);
    expect(edited.body.overrideApprovedBy).toBeUndefined();

    expect(edited.body.status).toBe('draft');

    await setLeadTime(quoteId);

    const blockedAgain = await sales
      .post(`/quoting/quotes/${quoteId}/transition`)
      .send({ to: 'quoted', lockVersion: await lockVersionOf(quoteId) });
    expect(blockedAgain.status).toBe(409);
    expect(blockedAgain.body.reason).toBe('override-not-approved');

    const decisions = await sales.get(`/quoting/quotes/${quoteId}/override/decisions`);
    expect(decisions.status).toBe(200);
    expect(decisions.body.items.map((d: { decision: string }) => d.decision)).toEqual([
      'requested',
      'approved',
      'revoked',
    ]);
    expect(decisions.body.items[2].actor).toBe('system:edit');
  });

  it('requires a reason to reject', async () => {
    const quoteId = await createQuote(sales);
    await putLines(sales, quoteId, [{ ...plainLine, overridePricePerRoll: '12.0000' }]);
    const lockVersion = await lockVersionOf(quoteId);
    const bare = await billing
      .post(`/quoting/quotes/${quoteId}/override/reject`)
      .send({ lockVersion });
    expect(bare.status).toBe(400);

    const rejected = await billing
      .post(`/quoting/quotes/${quoteId}/override/reject`)
      .send({ lockVersion, reason: 'match the list price instead' });
    expect(rejected.status).toBe(200);
  });

  it('lists exactly the quotes awaiting a price decision', async () => {
    const waiting = await createQuote(sales);
    await putLines(sales, waiting, [{ ...plainLine, overridePricePerRoll: '12.0000' }]);
    expect(
      (
        await sales
          .post(`/quoting/quotes/${waiting}/transition`)
          .send({ to: 'override_requested', lockVersion: await lockVersionOf(waiting) })
      ).status,
    ).toBe(200);

    const notYetAsked = await createQuote(sales);
    await putLines(sales, notYetAsked, [{ ...plainLine, overridePricePerRoll: '12.0000' }]);

    const listed = await billing.get('/quoting/quotes').query({ status: 'override_requested' });
    expect(listed.status).toBe(200);
    const ids = listed.body.items.map((q: { id: string }) => q.id);
    expect(ids).toContain(waiting);
    expect(ids).not.toContain(notYetAsked);
    for (const quote of listed.body.items as { status: string }[]) {
      expect(quote.status).toBe('override_requested');
    }

    const approved = await billing
      .post(`/quoting/quotes/${waiting}/override/approve`)
      .send({ lockVersion: await lockVersionOf(waiting) });
    expect(approved.status).toBe(200);
    expect(approved.body.status).toBe('draft');
    expect(approved.body.overrideApprovedBy).toBe('dev-billing');

    const after = await billing.get('/quoting/quotes').query({ status: 'override_requested' });
    expect(after.status).toBe(200);
    expect(after.body.items.map((q: { id: string }) => q.id)).not.toContain(waiting);

    const again = await billing
      .post(`/quoting/quotes/${waiting}/override/approve`)
      .send({ lockVersion: await lockVersionOf(waiting) });
    expect(again.status).toBe(409);
    expect(again.body.reason).toBe('override-already-approved');
    expect(again.body.value.approvedBy).toBe('dev-billing');

    const undo = await billing
      .post(`/quoting/quotes/${waiting}/override/reject`)
      .send({ lockVersion: await lockVersionOf(waiting), reason: 'second thoughts' });
    expect(undo.status).toBe(409);
    expect(undo.body.reason).toBe('override-already-approved');

    const trail = await billing.get(`/quoting/quotes/${waiting}/override/decisions`);
    expect(trail.body.items.map((d: { decision: string }) => d.decision)).toEqual([
      'requested',
      'approved',
    ]);
  });

  it('409s an approval of a quote carrying no hand-set price', async () => {
    const quoteId = await createQuote(sales);
    await putLines(sales, quoteId, [plainLine]);

    const nothing = await billing
      .post(`/quoting/quotes/${quoteId}/override/approve`)
      .send({ lockVersion: await lockVersionOf(quoteId) });
    expect(nothing.status).toBe(409);
    expect(nothing.body.reason).toBe('nothing-to-approve');
  });

  it('refuses an approval made against figures that have since changed', async () => {
    const quoteId = await createQuote(sales);
    await putLines(sales, quoteId, [{ ...plainLine, overridePricePerRoll: '12.0000' }]);
    expect(
      (
        await sales
          .post(`/quoting/quotes/${quoteId}/transition`)
          .send({ to: 'override_requested', lockVersion: await lockVersionOf(quoteId) })
      ).status,
    ).toBe(200);

    const asRead = await lockVersionOf(quoteId);

    const reprice = await putLines(sales, quoteId, [
      { ...plainLine, overridePricePerRoll: '8.7500' },
    ]);
    expect(reprice.status).toBe(200);

    expect(reprice.body.status).toBe('override_requested');

    const stale = await billing
      .post(`/quoting/quotes/${quoteId}/override/approve`)
      .send({ lockVersion: asRead });
    expect(stale.status).toBe(409);
    expect(stale.body.reason).toBe('stale-aggregate');
    expect(stale.body.value.expected).toBe(asRead);
    expect(stale.body.value.actual).toBeGreaterThan(asRead);

    const after = await sales.get(`/quoting/quotes/${quoteId}`);
    expect(after.body.overrideApprovedBy).toBeUndefined();
    const decisions = await sales.get(`/quoting/quotes/${quoteId}/override/decisions`);
    expect(decisions.body.items.map((d: { decision: string }) => d.decision)).toEqual([
      'requested',
    ]);

    const fresh = await billing
      .post(`/quoting/quotes/${quoteId}/override/approve`)
      .send({ lockVersion: await lockVersionOf(quoteId) });
    expect(fresh.status).toBe(200);
    expect(fresh.body.overrideApprovedBy).toBe('dev-billing');
  });

  it('requires the token — a decision with no precondition is the defect itself', async () => {
    const quoteId = await createQuote(sales);
    await putLines(sales, quoteId, [{ ...plainLine, overridePricePerRoll: '12.0000' }]);

    expect(
      (await billing.post(`/quoting/quotes/${quoteId}/override/approve`).send({})).status,
    ).toBe(400);
    expect(
      (await billing.post(`/quoting/quotes/${quoteId}/override/reject`).send({ reason: 'no' }))
        .status,
    ).toBe(400);
  });

  it('records the session user as the actor, ignoring a spoofed one in the body', async () => {
    const quoteId = await createQuote(sales);
    await putLines(sales, quoteId, [{ ...plainLine, overridePricePerRoll: '12.0000' }]);
    expect(
      (
        await sales
          .post(`/quoting/quotes/${quoteId}/transition`)
          .send({ to: 'override_requested', lockVersion: await lockVersionOf(quoteId) })
      ).status,
    ).toBe(200);

    const approved = await billing
      .post(`/quoting/quotes/${quoteId}/override/approve`)
      .send({ actor: 'someone-else', lockVersion: await lockVersionOf(quoteId) });
    expect(approved.status).toBe(200);
    expect(approved.body.overrideApprovedBy).toBe('dev-billing');

    const decisions = await sales.get(`/quoting/quotes/${quoteId}/override/decisions`);
    expect(decisions.status).toBe(200);
    expect(decisions.body.items).toHaveLength(2);

    expect(decisions.body.items[0]).toMatchObject({
      decision: 'requested',
      kind: 'price',
      actor: 'dev-sales',
    });
    expect(decisions.body.items[1].decision).toBe('approved');
    expect(decisions.body.items[1].actor).toBe('dev-billing');
  });

  it('ignores an actor in the transition body: the request is signed by the session', async () => {
    const quoteId = await createQuote(sales);
    await putLines(sales, quoteId, [{ ...plainLine, overridePricePerRoll: '12.0000' }]);

    const requested = await sales.post(`/quoting/quotes/${quoteId}/transition`).send({
      to: 'override_requested',
      lockVersion: await lockVersionOf(quoteId),
      actor: 'someone-else',
    });
    expect(requested.status).toBe(200);

    const decisions = await sales.get(`/quoting/quotes/${quoteId}/override/decisions`);
    expect(decisions.body.items).toEqual([
      expect.objectContaining({ decision: 'requested', kind: 'price', actor: 'dev-sales' }),
    ]);
  });
});

describe('Quoting edge — an Admin overrides the floor', () => {
  let admin: request.Agent;

  beforeAll(async () => {
    admin = await loginAgent('break-glass', BREAK_GLASS_PASSWORD);
  });

  async function owesBoth(): Promise<string> {
    const quoteId = await createQuote(sales);
    const saved = await putLines(sales, quoteId, [
      { ...plainLine, overridePricePerRoll: '2.4000' },
    ]);
    expect(saved.status).toBe(200);
    expect(saved.body.lines[0].floor.status).toBe('below_floor');
    return quoteId;
  }

  it('refuses both routes to Billing and Sales, and lets an Admin through', async () => {
    const quoteId = await owesBoth();
    for (const agent of [billing, sales]) {
      for (const verb of ['approve', 'reject']) {
        const refused = await agent
          .post(`/quoting/quotes/${quoteId}/floor-override/${verb}`)
          .send({ lockVersion: await lockVersionOf(quoteId), reason: 'mine to decide' });
        expect(refused.status).toBe(403);
      }
    }

    const approved = await admin
      .post(`/quoting/quotes/${quoteId}/floor-override/approve`)
      .send({ lockVersion: await lockVersionOf(quoteId), reason: 'strategic account' });
    expect(approved.status).toBe(200);
    expect(approved.body.floorOverrideBy).toBe('break-glass');
    expect(approved.body.floorOverrideAt).toBeDefined();
  });

  it('requires a reason both ways: 400 floor-override-reason-required', async () => {
    const quoteId = await owesBoth();
    for (const verb of ['approve', 'reject']) {
      for (const reason of [undefined, '   ']) {
        const bare = await admin
          .post(`/quoting/quotes/${quoteId}/floor-override/${verb}`)
          .send({ lockVersion: await lockVersionOf(quoteId), reason });
        expect(bare.status).toBe(400);
        expect(bare.body.reason).toBe('floor-override-reason-required');
      }
    }

    const decisions = await sales.get(`/quoting/quotes/${quoteId}/override/decisions`);
    expect(decisions.body.items).toEqual([]);
  });

  it('409s nothing-below-floor on a quote with no below-floor line', async () => {
    const quoteId = await createQuote(sales);
    await putLines(sales, quoteId, [plainLine]);

    const nothing = await admin
      .post(`/quoting/quotes/${quoteId}/floor-override/approve`)
      .send({ lockVersion: await lockVersionOf(quoteId), reason: 'just in case' });
    expect(nothing.status).toBe(409);
    expect(nothing.body).toMatchObject({ reason: 'nothing-below-floor', value: quoteId });
  });

  it('409s floor-override-already-approved on a second decision, either way round', async () => {
    const quoteId = await owesBoth();
    expect(
      (
        await admin
          .post(`/quoting/quotes/${quoteId}/floor-override/approve`)
          .send({ lockVersion: await lockVersionOf(quoteId), reason: 'strategic account' })
      ).status,
    ).toBe(200);

    for (const verb of ['approve', 'reject']) {
      const again = await admin
        .post(`/quoting/quotes/${quoteId}/floor-override/${verb}`)
        .send({ lockVersion: await lockVersionOf(quoteId), reason: 'second thoughts' });
      expect(again.status).toBe(409);
      expect(again.body).toMatchObject({
        reason: 'floor-override-already-approved',
        value: { quoteId, overriddenBy: 'break-glass' },
      });
    }
  });

  it('walks request, both decisions, send; the decisions read carries each kind', async () => {
    const quoteId = await owesBoth();
    await setLeadTime(quoteId);

    const requested = await sales
      .post(`/quoting/quotes/${quoteId}/transition`)
      .send({ to: 'override_requested', lockVersion: await lockVersionOf(quoteId) });
    expect(requested.status).toBe(200);

    const floor = await admin
      .post(`/quoting/quotes/${quoteId}/floor-override/approve`)
      .send({ lockVersion: await lockVersionOf(quoteId), reason: 'strategic account' });
    expect(floor.status).toBe(200);
    expect(floor.body.status).toBe('override_requested');

    const blocked = await sales
      .post(`/quoting/quotes/${quoteId}/transition`)
      .send({ to: 'quoted', lockVersion: await lockVersionOf(quoteId) });
    expect(blocked.status).toBe(409);
    expect(blocked.body.reason).toBe('override-not-approved');

    const price = await billing
      .post(`/quoting/quotes/${quoteId}/override/approve`)
      .send({ lockVersion: await lockVersionOf(quoteId) });
    expect(price.status).toBe(200);
    expect(price.body.status).toBe('draft');

    const sendability = await sales.get(`/quoting/quotes/${quoteId}/sendability`);
    expect(sendability.body).toEqual({ sendable: true });

    const sent = await sales
      .post(`/quoting/quotes/${quoteId}/transition`)
      .send({ to: 'quoted', lockVersion: await lockVersionOf(quoteId) });
    expect(sent.status).toBe(200);
    expect(sent.body.status).toBe('quoted');

    const decisions = await sales.get(`/quoting/quotes/${quoteId}/override/decisions`);
    expect(decisions.status).toBe(200);
    const trail = decisions.body.items.map(
      (d: { decision: string; kind: string }) => `${d.decision}:${d.kind}`,
    );
    expect([...trail.slice(0, 2)].sort()).toEqual(['requested:floor', 'requested:price']);
    expect(trail.slice(2)).toEqual(['approved:floor', 'approved:price']);
    expect(decisions.body.items[2]).toMatchObject({
      actor: 'break-glass',
      reason: 'strategic account',
    });
  });

  it('sends a rejected request back to draft, with the reason on the trail', async () => {
    const quoteId = await owesBoth();
    await sales
      .post(`/quoting/quotes/${quoteId}/transition`)
      .send({ to: 'override_requested', lockVersion: await lockVersionOf(quoteId) });

    const rejected = await admin
      .post(`/quoting/quotes/${quoteId}/floor-override/reject`)
      .send({ lockVersion: await lockVersionOf(quoteId), reason: 'too thin for this account' });
    expect(rejected.status).toBe(200);
    expect(rejected.body.status).toBe('draft');
    expect(rejected.body.floorOverrideBy).toBeUndefined();

    const decisions = await sales.get(`/quoting/quotes/${quoteId}/override/decisions`);
    const items = decisions.body.items as unknown[];
    expect(items[items.length - 1]).toMatchObject({
      decision: 'rejected',
      kind: 'floor',
      reason: 'too thin for this account',
    });
  });
});

describe('Quoting edge — retiring a footage variant in use', () => {
  const footages = [
    { variant: 'long', label: 'Long roll', feetPerRoll: '1000.0000' },
    { variant: 'short', label: 'Short roll', feetPerRoll: '765.0000' },
  ];

  async function ownGrade(code: string): Promise<{ id: string; lockVersion: number }> {
    const created = await billing.post('/quoting/grades').send({
      productFamily: 'kraft',
      code,
      basisWeightLb: '37.0000',
      paperCostPerTonne: '900.0000',
      footages,
    });
    expect(created.status).toBe(201);
    return { id: created.body.id as string, lockVersion: created.body.lockVersion as number };
  }

  it('409s a patch that would orphan a draft line, and names it', async () => {
    const { id: gradeId, lockVersion } = await ownGrade('286 in use');
    const quoteId = await createQuote(sales);
    expect((await putLines(sales, quoteId, [{ ...plainLine, gradeId }])).status).toBe(200);

    const refused = await billing
      .patch(`/quoting/grades/${gradeId}`)
      .send({ footages: [footages[1]], lockVersion });

    expect(refused.status).toBe(409);
    expect(refused.body.reason).toBe('footage-variant-in-use');
    expect(refused.body.variant).toBe('long');
    expect(refused.body.lines).toEqual([{ quoteId, lineNumber: 1 }]);
  });

  it('allows the same patch once the quote is sent, because a sent quote is sealed', async () => {
    const { id: gradeId, lockVersion } = await ownGrade('286 sealed');
    const quoteId = await createQuote(sales);
    expect((await putLines(sales, quoteId, [{ ...plainLine, gradeId }])).status).toBe(200);
    await setLeadTime(quoteId);
    expect(
      (
        await sales
          .post(`/quoting/quotes/${quoteId}/transition`)
          .send({ to: 'quoted', lockVersion: await lockVersionOf(quoteId) })
      ).status,
    ).toBe(200);

    const allowed = await billing
      .patch(`/quoting/grades/${gradeId}`)
      .send({ footages: [footages[1]], lockVersion });

    expect(allowed.status).toBe(200);
    expect((allowed.body.footages as { variant: string }[]).map((f) => f.variant)).toEqual([
      'short',
    ]);
  });

  it('allows an edit that keeps every variant', async () => {
    const { id: gradeId, lockVersion } = await ownGrade('286 kept');
    const quoteId = await createQuote(sales);
    expect((await putLines(sales, quoteId, [{ ...plainLine, gradeId }])).status).toBe(200);

    const allowed = await billing.patch(`/quoting/grades/${gradeId}`).send({
      footages: [{ ...footages[0], label: 'Long roll (relabelled)' }, footages[1]],
      lockVersion,
    });

    expect(allowed.status).toBe(200);
    expect(
      (allowed.body.footages as { variant: string; label: string }[]).find(
        (f) => f.variant === 'long',
      )?.label,
    ).toBe('Long roll (relabelled)');
  });
});

describe('Quoting edge — unknown references map to 422', () => {
  it('422s a quote created against a customer that does not exist', async () => {
    const response = await sales.post('/quoting/quotes').send({ customerId: 'nobody' });
    expect(response.status).toBe(422);
    expect(response.body.reason).toBe('unknown-customer');
    expect(response.body.value).toBe('nobody');
  });

  it('422s a line naming a grade that does not exist', async () => {
    const quoteId = await createQuote(sales);
    const response = await putLines(sales, quoteId, [{ ...plainLine, gradeId: 'no-such-grade' }]);
    expect(response.status).toBe(422);
    expect(response.body.reason).toBe('unknown-grade-on-line');
  });

  it('422s a line naming a footage variant its grade lacks', async () => {
    const quoteId = await createQuote(sales);
    const response = await putLines(sales, quoteId, [{ ...plainLine, footageVariant: '500' }]);
    expect(response.status).toBe(422);
    expect(response.body.reason).toBe('unknown-footage-variant');
    expect(response.body.value).toBe('500');
  });

  it('404s reads and writes against an unknown quote id', async () => {
    expect((await sales.get('/quoting/quotes/00000000-0000-4000-8000-000000000000')).status).toBe(
      404,
    );
    expect((await putLines(sales, 'no-such-quote', [plainLine], 1)).status).toBe(404);
    expect(
      (
        await sales
          .post('/quoting/quotes/00000000-0000-4000-8000-000000000000/transition')
          .send({ to: 'quoted', lockVersion: 1 })
      ).status,
    ).toBe(404);
  });
});

describe('Quoting edge — revision', () => {
  it('409s a revision for a customer put on credit hold after the quote was sent', async () => {
    const created = await sales.post('/crm/customers').send({
      billingAddress: QUOTABLE_BILLING_ADDRESS,
      name: 'Revise Held Co',
      legacyAccountNumber: 'LA-Q-REVHELD',
    });
    expect(created.status).toBe(201);
    const customerId = created.body.id as string;

    const quote = await sales.post('/quoting/quotes').send({ customerId });
    expect(quote.status).toBe(201);
    const quoteId = quote.body.id as string;
    expect((await putLines(sales, quoteId, [plainLine])).status).toBe(200);
    await setLeadTime(quoteId);
    expect(
      (
        await sales
          .post(`/quoting/quotes/${quoteId}/transition`)
          .send({ to: 'quoted', lockVersion: await lockVersionOf(quoteId) })
      ).status,
    ).toBe(200);

    expect(
      (
        await billing
          .put(`/crm/customers/${customerId}/credit-hold`)
          .send({ held: true, lockVersion: created.body.lockVersion })
      ).status,
    ).toBe(200);

    const revised = await sales.post(`/quoting/quotes/${quoteId}/revise`).send({});

    expect(revised.status).toBe(409);
    expect(revised.body.reason).toBe('customer-on-credit-hold');

    const original = await sales.get(`/quoting/quotes/${quoteId}`);
    expect(original.body.versionNumber).toBe(1);
  });

  it('revises a sent quote into a v2 draft and keeps the original readable', async () => {
    const quoteId = await createQuote(sales);
    const saved = await putLines(sales, quoteId, [plainLine]);
    expect(saved.status).toBe(200);
    const quotedAt = saved.body.lines[0].pricePerRoll;
    await setLeadTime(quoteId);
    expect(
      (
        await sales
          .post(`/quoting/quotes/${quoteId}/transition`)
          .send({ to: 'quoted', lockVersion: await lockVersionOf(quoteId) })
      ).status,
    ).toBe(200);

    const revised = await sales.post(`/quoting/quotes/${quoteId}/revise`).send({});
    expect(revised.status).toBe(200);
    expect(revised.body.status).toBe('draft');
    expect(revised.body.versionNumber).toBe(2);
    expect(revised.body.rootQuoteId).toBe(quoteId);

    expect(revised.body.lines[0].pricePerRoll).toBe(quotedAt);

    const original = await sales.get(`/quoting/quotes/${quoteId}`);
    expect(original.status).toBe(200);
    expect(original.body.status).toBe('superseded');

    const versions = await sales.get(`/quoting/quotes/${quoteId}/versions`);
    expect(versions.status).toBe(200);
    expect(versions.body.items.map((q: { versionNumber: number }) => q.versionNumber)).toEqual([
      1, 2,
    ]);

    const reviseDraft = await sales.post(`/quoting/quotes/${revised.body.id}/revise`).send({});
    expect(reviseDraft.status).toBe(409);
    expect(reviseDraft.body.reason).toBe('quote-not-revisable');
  });
});

describe('PUT /quoting/quotes/:id/lines - freight in the price per roll', () => {
  it('saves the flag with the lines, keeps it on a save without it, and revises it forward', async () => {
    const quoteId = await createQuote(sales);
    expect((await sales.get(`/quoting/quotes/${quoteId}`)).body.freightInRollPrice).toBe(false);

    const ticked = await sales.put(`/quoting/quotes/${quoteId}/lines`).send({
      lines: [plainLine],
      lockVersion: await lockVersionOf(quoteId),
      freightInRollPrice: true,
    });
    expect(ticked.status).toBe(200);
    expect(ticked.body.freightInRollPrice).toBe(true);

    const kept = await putLines(sales, quoteId, [plainLine]);
    expect(kept.status).toBe(200);
    expect(kept.body.freightInRollPrice).toBe(true);

    await setLeadTime(quoteId);
    expect(
      (
        await sales
          .post(`/quoting/quotes/${quoteId}/transition`)
          .send({ to: 'quoted', lockVersion: await lockVersionOf(quoteId) })
      ).status,
    ).toBe(200);
    const revised = await sales.post(`/quoting/quotes/${quoteId}/revise`).send({});
    expect(revised.status).toBe(200);
    expect(revised.body.freightInRollPrice).toBe(true);
  });

  it('refuses a flag that is not a boolean', async () => {
    const quoteId = await createQuote(sales);
    const response = await sales.put(`/quoting/quotes/${quoteId}/lines`).send({
      lines: [plainLine],
      lockVersion: await lockVersionOf(quoteId),
      freightInRollPrice: 'yes',
    });
    expect(response.status).toBe(400);
  });
});

describe('Quoting edge — the quote PDF', () => {
  async function sentQuote(): Promise<string> {
    const quoteId = await createQuote(sales);
    await putLines(sales, quoteId, [plainLine]);
    await setLeadTime(quoteId);
    await sales
      .post(`/quoting/quotes/${quoteId}/transition`)
      .send({ to: 'quoted', lockVersion: await lockVersionOf(quoteId) });
    return quoteId;
  }

  it('refuses a draft, naming the status (B1)', async () => {
    const quoteId = await createQuote(sales);
    await putLines(sales, quoteId, [plainLine]);

    const refused = await sales.get(`/quoting/quotes/${quoteId}/document`);

    expect(refused.status).toBe(409);
    expect(refused.body.reason).toBe('quote-not-printable');
    expect(refused.body.value).toBe('draft');
  });

  it('renders a sent quote as a PDF', async () => {
    const quoteId = await sentQuote();

    const res = await sales.get(`/quoting/quotes/${quoteId}/document`).buffer();

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    expect(res.headers['content-disposition']).toContain('.pdf');

    expect(res.body.length).toBeGreaterThan(0);
    expect(Buffer.from(res.body).subarray(0, 4).toString()).toBe('%PDF');
  });

  it('sets nosniff, and takes the content type from the stored record', async () => {
    const quoteId = await sentQuote();

    const res = await sales.get(`/quoting/quotes/${quoteId}/document`).buffer();

    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-type']).toContain('application/pdf');
  });

  it('serves a document this system generated inline', async () => {
    const quoteId = await sentQuote();

    const res = await sales.get(`/quoting/quotes/${quoteId}/document`).buffer();

    expect(res.headers['content-disposition']).toMatch(/^inline; filename="/);
  });

  it('serves byte-identical content on a second request (B3)', async () => {
    const quoteId = await sentQuote();

    const first = await sales.get(`/quoting/quotes/${quoteId}/document`).buffer();
    const second = await sales.get(`/quoting/quotes/${quoteId}/document`).buffer();

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(Buffer.from(second.body).equals(Buffer.from(first.body))).toBe(true);
  });

  it('names the delivery method, never our routing', async () => {
    const quoteId = await createQuote(sales);
    await putLines(sales, quoteId, [
      { ...plainLine, freight: { mode: 'pass_through', carrierBid: '83.0000' } },
    ]);
    await setLeadTime(quoteId);
    await sales
      .post(`/quoting/quotes/${quoteId}/transition`)
      .send({ to: 'quoted', lockVersion: await lockVersionOf(quoteId) });

    const res = await sales.get(`/quoting/quotes/${quoteId}/document`).buffer();
    expect(res.status).toBe(200);

    const raw = Buffer.from(res.body).toString('latin1');
    for (const leak of ['pass_through', 'our_vehicle', 'Sample Harbor']) {
      expect(raw).not.toContain(leak);
    }
  });

  it('requires a signed-in user', async () => {
    const quoteId = await sentQuote();
    const anon = request(app.getHttpServer());

    expect((await anon.get(`/quoting/quotes/${quoteId}/document`)).status).toBe(401);
  });

  it('404s an unknown quote', async () => {
    expect(
      (await sales.get('/quoting/quotes/00000000-0000-4000-8000-000000000000/document')).status,
    ).toBe(404);
  });
});

describe('POST /quoting/quotes/:id/send', () => {
  async function customerWithContacts(emails: readonly (string | undefined)[]): Promise<string> {
    const created = await sales.post('/crm/customers').send({
      billingAddress: QUOTABLE_BILLING_ADDRESS,
      name: `Send E2E ${emails.join('-') || 'nobody'}`,
    });
    expect(created.status).toBe(201);
    const id = created.body.id as string;
    let tagged: { id: string; lockVersion: number } | undefined;
    for (const [index, email] of emails.entries()) {
      const contact = await sales
        .post(`/crm/customers/${id}/contacts`)
        .send({ name: `Contact ${index}`, ...(email === undefined ? {} : { email }) });
      expect(contact.status).toBe(201);

      if (email !== undefined && tagged === undefined) {
        tagged = { id: contact.body.id as string, lockVersion: contact.body.lockVersion };
      }
    }
    if (tagged !== undefined) {
      const set = await sales
        .patch(`/crm/customers/${id}/contacts/${tagged.id}`)
        .send({ roles: [...MAIL_CONTACT_ROLES], lockVersion: tagged.lockVersion });
      expect(set.status, JSON.stringify(set.body)).toBe(200);
    }
    return id;
  }

  async function quotedFor(customer: string): Promise<string> {
    const created = await sales.post('/quoting/quotes').send({ customerId: customer });
    expect(created.status).toBe(201);
    const quoteId = created.body.id as string;

    await setLeadTime(quoteId);
    await putLines(sales, quoteId, [plainLine]);
    const sent = await sales
      .post(`/quoting/quotes/${quoteId}/transition`)
      .send({ to: 'quoted', lockVersion: await lockVersionOf(quoteId) });
    expect(sent.status).toBe(200);
    return quoteId;
  }

  const send = async (quoteId: string, over: Record<string, unknown> = {}) =>
    sales.post(`/quoting/quotes/${quoteId}/send`).send({
      lockVersion: await lockVersionOf(quoteId),
      ...over,
    });

  it('emails the quote to the designated recipient alone', async () => {
    const customer = await customerWithContacts(['buyer@example.com', 'ap@example.com']);
    const quoteId = await quotedFor(customer);
    const before = mail.submissions.length;

    const response = await send(quoteId);

    expect(response.status).toBe(200);

    expect(mail.submissions).toHaveLength(before + 2);
    const submitted = mail.submissions[before]!;

    expect(submitted.mail.to).toEqual(['buyer@example.com']);

    expect(submitted.mail.attachments).toHaveLength(1);
    expect(submitted.mail.attachments?.[0]?.contentType).toBe('application/pdf');
    expect(submitted.mail.attachments?.[0]?.bytes.byteLength).toBeGreaterThan(0);
  });

  it('records the send in the shared log, recipients and actor included', async () => {
    const customer = await customerWithContacts(['buyer@example.com', 'ap@example.com']);
    const quoteId = await quotedFor(customer);

    const before = mail.submissions.length;

    expect((await send(quoteId)).status).toBe(200);

    const logged = await sendLog.latestFor(
      { type: 'quote', id: quoteId },
      { audience: 'customer' },
    );
    expect(logged).toMatchObject({
      subject: { type: 'quote', id: quoteId },

      recipients: ['buyer@example.com'],

      actor: 'dev-sales',
      outcome: 'accepted',
    });

    const customerCopy = mail.submissions
      .slice(before)
      .find((s) => s.mail.to.includes('buyer@example.com'));
    expect(logged?.messageId).toBe(customerCopy?.submission.messageId);
  });

  it('leaves the recipients out of quoting and in the log', async () => {
    const customer = await customerWithContacts(['ap@example.com']);
    const quoteId = await quotedFor(customer);

    const response = await send(quoteId);

    expect(response.status).toBe(200);

    expect(response.body).toHaveProperty('messageId');
    expect(response.body).not.toHaveProperty('recipients');

    expect(
      (await sendLog.latestFor({ type: 'quote', id: quoteId }, { audience: 'customer' }))
        ?.recipients,
    ).toEqual(['ap@example.com']);
  });

  it('returns the send record, correlated to the message that went out', async () => {
    const customer = await customerWithContacts(['buyer@example.com']);
    const quoteId = await quotedFor(customer);

    const before = mail.submissions.length;

    const response = await send(quoteId);

    expect(response.status).toBe(200);
    expect(response.body.quoteId).toBe(quoteId);

    expect(response.body.messageId).toBe(mail.submissions[before]!.submission.messageId);
    expect(response.body.actor).toBe('dev-sales');
  });

  it('skips a contact with no address rather than mailing a blank', async () => {
    const customer = await customerWithContacts(['buyer@example.com', undefined]);
    const quoteId = await quotedFor(customer);
    const before = mail.submissions.length;

    expect((await send(quoteId)).status).toBe(200);
    expect(mail.submissions[before]!.mail.to).toEqual(['buyer@example.com']);
  });

  it('422s a customer nobody can be reached at, naming the customer', async () => {
    const customer = await customerWithContacts([undefined]);
    const quoteId = await quotedFor(customer);

    const response = await send(quoteId);

    expect(response.status).toBe(422);

    expect(response.body.reason).toBe('no-quote-recipient');
    expect(response.body.value).toBe(customer);
  });

  it('answers the role-named 422, not a 409, when the screen and the account both hold nobody', async () => {
    const customer = await customerWithContacts([undefined]);
    const quoteId = await quotedFor(customer);

    const response = await send(quoteId, { confirmRecipients: [] });

    expect(response.status).toBe(422);
    expect(response.body.reason).toBe('no-quote-recipient');
  });

  it('answers 409 when the screen showed nobody and the account has since been tagged', async () => {
    const customer = await customerWithContacts(['buyer@example.com']);
    const quoteId = await quotedFor(customer);

    const response = await send(quoteId, { confirmRecipients: [] });

    expect(response.status).toBe(409);
    expect(response.body.reason).toBe('recipient-changed');
    expect(response.body.value.designated).toEqual(['buyer@example.com']);
  });

  it('sends a draft whole: quoted, the PDF stored, the email out, the send recorded', async () => {
    const customer = await customerWithContacts(['buyer@example.com']);
    const created = await sales.post('/quoting/quotes').send({ customerId: customer });
    const quoteId = created.body.id as string;
    await putLines(sales, quoteId, [plainLine]);
    await setLeadTime(quoteId);
    const before = mail.submissions.length;

    const response = await send(quoteId, { confirmRecipients: ['buyer@example.com'] });

    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body.quoteId).toBe(quoteId);
    expect((await sales.get(`/quoting/quotes/${quoteId}`)).body.status).toBe('quoted');
    const stored = await app.get(DocumentService).listForSubject({ type: 'quote', id: quoteId });
    expect(stored.filter((doc) => doc.kind === 'quote')).toHaveLength(1);
    const toCustomer = mail.submissions
      .slice(before)
      .filter((s) => s.mail.to.includes('buyer@example.com'));
    expect(toCustomer).toHaveLength(1);
    expect(toCustomer[0]!.mail.attachments).toHaveLength(1);
    const sends = await sales.get(`/quoting/quotes/${quoteId}/sends`);
    expect(sends.status).toBe(200);
    expect(sends.body.items.length).toBeGreaterThan(0);
  });

  it('refuses a draft with no lead time and leaves it a draft with nothing stored', async () => {
    const customer = await customerWithContacts(['buyer@example.com']);
    const created = await sales.post('/quoting/quotes').send({ customerId: customer });
    const quoteId = created.body.id as string;
    await putLines(sales, quoteId, [plainLine]);
    const before = mail.submissions.length;

    const response = await send(quoteId, { confirmRecipients: ['buyer@example.com'] });

    expect(response.status).toBe(409);

    expect(response.body.reason).toBe('quote-needs-lead-time');
    expect((await sales.get(`/quoting/quotes/${quoteId}`)).body.status).toBe('draft');
    expect(
      await app.get(DocumentService).listForSubject({ type: 'quote', id: quoteId }),
    ).toHaveLength(0);
    expect(mail.submissions).toHaveLength(before);
  });

  it('still refuses a status that can neither move to quoted nor print', async () => {
    const customer = await customerWithContacts(['buyer@example.com']);
    const created = await sales.post('/quoting/quotes').send({ customerId: customer });
    const quoteId = created.body.id as string;
    const lost = await sales
      .post(`/quoting/quotes/${quoteId}/transition`)
      .send({ to: 'closed_lost', lockVersion: await lockVersionOf(quoteId) });
    expect(lost.status).toBe(200);

    const response = await send(quoteId);

    expect(response.status).toBe(409);
    expect(response.body.reason).toBe('quote-not-printable');
  });

  it('refuses figures the caller never read', async () => {
    const customer = await customerWithContacts(['buyer@example.com']);
    const quoteId = await quotedFor(customer);
    const stale = (await lockVersionOf(quoteId)) + 1;

    const response = await sales
      .post(`/quoting/quotes/${quoteId}/send`)
      .send({ lockVersion: stale });

    expect(response.status).toBe(409);
    expect(response.body.reason).toBe('stale-aggregate');
  });

  it('lets the first send through, then refuses the second unconfirmed', async () => {
    const customer = await customerWithContacts(['buyer@example.com']);
    const quoteId = await quotedFor(customer);
    const before = mail.submissions.length;

    expect((await send(quoteId)).status).toBe(200);

    const firstMessageId = mail.submissions
      .slice(before)
      .find((s) => s.mail.to.includes('buyer@example.com'))!.submission.messageId;

    const second = await send(quoteId);
    expect(second.status).toBe(409);
    expect(second.body.reason).toBe('redistribution-not-confirmed');

    expect(second.body.value).toHaveLength(1);
    expect(typeof second.body.value[0].when).toBe('string');
    expect(second.body.value[0].messageId).toBe(firstMessageId);
    expect(second.body.value[0]).not.toHaveProperty('to');
  });

  it('sends the second once it is confirmed', async () => {
    const customer = await customerWithContacts(['buyer@example.com']);
    const quoteId = await quotedFor(customer);
    expect((await send(quoteId)).status).toBe(200);
    const before = mail.submissions.length;

    expect((await send(quoteId, { confirmRedistribute: true })).status).toBe(200);

    expect(mail.submissions).toHaveLength(before + 2);
  });

  it('writes no record when the relay refuses the message', async () => {
    const customer = await customerWithContacts(['buyer@example.com']);
    const quoteId = await quotedFor(customer);

    mail.failNextSubmissions(10);

    const failed = await send(quoteId);
    expect(failed.status).toBeGreaterThanOrEqual(500);

    mail.failNextSubmissions(0);

    expect((await send(quoteId)).status).toBe(200);
  });

  it('puts a draft back to draft when the relay refuses, with no document to serve', async () => {
    const customer = await customerWithContacts(['buyer@example.com']);
    const created = await sales.post('/quoting/quotes').send({ customerId: customer });
    const quoteId = created.body.id as string;
    await putLines(sales, quoteId, [plainLine]);
    await setLeadTime(quoteId);

    mail.failNextSubmissions(10);
    const failed = await send(quoteId, { confirmRecipients: ['buyer@example.com'] });
    mail.failNextSubmissions(0);

    expect(failed.status).toBe(503);
    expect(failed.body.reason).toBe('relay-unreachable');
    expect((await sales.get(`/quoting/quotes/${quoteId}`)).body.status).toBe('draft');
    const refused = await sales.get(`/quoting/quotes/${quoteId}/document`);
    expect(refused.status).toBe(409);
    expect(refused.body.reason).toBe('quote-not-printable');
  });

  it('mails a fresh document after a refused send and an edit, not the one rendered before', async () => {
    const customer = await customerWithContacts(['buyer@example.com']);
    const created = await sales.post('/quoting/quotes').send({ customerId: customer });
    const quoteId = created.body.id as string;
    await putLines(sales, quoteId, [plainLine]);
    await setLeadTime(quoteId);
    const documents = app.get(DocumentService);
    const quoteDocuments = async () =>
      (await documents.listForSubject({ type: 'quote', id: quoteId })).filter(
        (doc) => doc.kind === 'quote',
      );
    mail.failNextSubmissions(10);
    await send(quoteId, { confirmRecipients: ['buyer@example.com'] });
    mail.failNextSubmissions(0);
    const renderedForRefusedSend = new Set((await quoteDocuments()).map((doc) => doc.id));
    expect((await putLines(sales, quoteId, [{ ...plainLine, quantityRolls: 37 }])).status).toBe(
      200,
    );
    const before = mail.submissions.length;

    const response = await send(quoteId, { confirmRecipients: ['buyer@example.com'] });

    expect(response.status, JSON.stringify(response.body)).toBe(200);
    const fresh = (await quoteDocuments()).filter((doc) => !renderedForRefusedSend.has(doc.id));
    expect(fresh).toHaveLength(1);
    const attached = mail.submissions
      .slice(before)
      .find((s) => s.mail.to.includes('buyer@example.com'))!.mail.attachments![0]!;
    expect(Buffer.from(attached.bytes).equals(Buffer.from(await documents.read(fresh[0]!)))).toBe(
      true,
    );
  });

  it('serves and mails the quote as it now stands after a refused send, an edit and a move to Quoted without sending', async () => {
    const customer = await customerWithContacts(['buyer@example.com']);
    const created = await sales.post('/quoting/quotes').send({ customerId: customer });
    const quoteId = created.body.id as string;
    await putLines(sales, quoteId, [{ ...plainLine, quantityRolls: 23 }]);
    await setLeadTime(quoteId);
    mail.failNextSubmissions(10);
    expect((await send(quoteId, { confirmRecipients: ['buyer@example.com'] })).status).toBe(503);
    mail.failNextSubmissions(0);
    expect((await putLines(sales, quoteId, [{ ...plainLine, quantityRolls: 61 }])).status).toBe(
      200,
    );
    const marked = await sales
      .post(`/quoting/quotes/${quoteId}/transition`)
      .send({ to: 'quoted', lockVersion: await lockVersionOf(quoteId) });
    expect(marked.status).toBe(200);

    const served = await sales.get(`/quoting/quotes/${quoteId}/document`).buffer();

    expect(served.status).toBe(200);
    const servedRuns = pdfTextRuns(served.body as Buffer);
    expect(servedRuns).toContain('61');
    expect(servedRuns).not.toContain('23');

    const before = mail.submissions.length;
    expect((await send(quoteId, { confirmRecipients: ['buyer@example.com'] })).status).toBe(200);
    const attached = mail.submissions
      .slice(before)
      .find((s) => s.mail.to.includes('buyer@example.com'))!.mail.attachments![0]!;
    const mailedRuns = pdfTextRuns(attached.bytes);
    expect(mailedRuns).toContain('61');
    expect(mailedRuns).not.toContain('23');
    expect(Buffer.from(attached.bytes).equals(served.body as Buffer)).toBe(true);
  });

  it('says the quote was left showing as sent when the relay refuses and the undo cannot be written', async () => {
    const customer = await customerWithContacts(['buyer@example.com']);
    const created = await sales.post('/quoting/quotes').send({ customerId: customer });
    const quoteId = created.body.id as string;
    await putLines(sales, quoteId, [plainLine]);
    await setLeadTime(quoteId);
    const repository = quotingStores.quotes;
    const transition = repository.transition.bind(repository);
    let moves = 0;
    const spy = vi.spyOn(repository, 'transition').mockImplementation(async (...args) => {
      moves += 1;
      if (moves > 1) throw new Error('the database went away');
      return transition(...args);
    });
    mail.failNextSubmissions(10);

    const failed = await send(quoteId, { confirmRecipients: ['buyer@example.com'] });

    mail.failNextSubmissions(0);
    spy.mockRestore();
    expect(failed.status).toBe(503);
    expect(failed.body).toMatchObject({ reason: 'relay-unreachable', value: 'left-quoted' });
    expect((await sales.get(`/quoting/quotes/${quoteId}`)).body.status).toBe('quoted');
    expect(logged).toContainEqual(
      expect.objectContaining({
        event: 'quote_send_undo_failed',
        quoteId,
        reason: 'write-failed',
        undoError: 'the database went away',
      }),
    );
  });

  it('answers 500 and logs the full record when the relay took the mail and the send cannot be recorded', async () => {
    const customer = await customerWithContacts(['buyer@example.com']);
    const quoteId = await quotedFor(customer);
    const spy = vi
      .spyOn(quotingStores.quotes, 'recordSend')
      .mockRejectedValueOnce(new Error('the database went away'));
    const before = mail.submissions.length;

    const response = await send(quoteId, { confirmRecipients: ['buyer@example.com'] });

    spy.mockRestore();
    const mailed = mail.submissions
      .slice(before)
      .find((s) => s.mail.to.includes('buyer@example.com'))!.submission;
    expect(response.status).toBe(500);
    expect(response.body).toMatchObject({ reason: 'send-not-recorded', value: mailed.messageId });
    expect((await sales.get(`/quoting/quotes/${quoteId}/sends`)).body.items).toContainEqual(
      expect.objectContaining({ messageId: mailed.messageId, outcome: 'accepted' }),
    );
    expect(logged).toContainEqual(
      expect.objectContaining({
        event: 'quote_send_not_recorded',
        quoteId,
        messageId: mailed.messageId,
        actor: 'dev-sales',
        acceptedByRelayAt: mailed.acceptedByRelayAt.toISOString(),
        error: 'the database went away',
      }),
    );
  });

  it('is Sales/Admin only', async () => {
    const customer = await customerWithContacts(['buyer@example.com']);
    const quoteId = await quotedFor(customer);

    expect(
      (await billing.post(`/quoting/quotes/${quoteId}/send`).send({ lockVersion: 1 })).status,
    ).toBe(403);
    expect(
      (await noroles.post(`/quoting/quotes/${quoteId}/send`).send({ lockVersion: 1 })).status,
    ).toBe(403);
    expect(
      (await http().post(`/quoting/quotes/${quoteId}/send`).send({ lockVersion: 1 })).status,
    ).toBe(401);
  });

  it('400s a body with no lockVersion', async () => {
    const customer = await customerWithContacts(['buyer@example.com']);
    const quoteId = await quotedFor(customer);

    expect((await sales.post(`/quoting/quotes/${quoteId}/send`).send({})).status).toBe(400);
  });

  it('404s an unknown quote', async () => {
    expect(
      (
        await sales
          .post('/quoting/quotes/00000000-0000-4000-8000-000000000000/send')
          .send({ lockVersion: 1 })
      ).status,
    ).toBe(404);
  });

  describe('and the evidence it leaves — GET /quoting/quotes/:id/sends', () => {
    const sends = async (quoteId: string, agent: request.Agent = sales) =>
      agent.get(`/quoting/quotes/${quoteId}/sends`);

    it('is empty for a quote nobody has sent', async () => {
      const quoteId = await quotedFor(await customerWithContacts(['buyer@example.com']));

      const response = await sends(quoteId);

      expect(response.status).toBe(200);
      expect(response.body.items).toEqual([]);
    });

    it('lists the customer copy with the addresses and the actor', async () => {
      const customer = await customerWithContacts(['buyer@example.com', 'ap@example.com']);
      const quoteId = await quotedFor(customer);
      const before = mail.submissions.length;
      expect((await send(quoteId)).status).toBe(200);

      const { body } = await sends(quoteId);
      const customerCopy = body.items.find(
        (row: Record<string, unknown>) => row.audience === 'customer',
      );

      expect(customerCopy).toMatchObject({
        recipients: ['buyer@example.com'],
        audience: 'customer',
        actor: 'dev-sales',
        outcome: 'accepted',
        unreachableHolders: [],
      });

      expect(customerCopy).not.toHaveProperty('failureReason');

      expect(customerCopy.messageId).toBe(
        mail.submissions.slice(before).find((s) => s.mail.to.includes('buyer@example.com'))
          ?.submission.messageId,
      );
      expect(typeof customerCopy.submittedAt).toBe('string');
    });

    it('lists the production alert beside it, newest first', async () => {
      const quoteId = await quotedFor(await customerWithContacts(['buyer@example.com']));
      expect((await send(quoteId)).status).toBe(200);

      const { body } = await sends(quoteId);

      expect(body.items.map((row: Record<string, unknown>) => row.audience)).toEqual([
        'internal',
        'internal',
        'customer',
      ]);

      expect(body.items[0]).toMatchObject({ actor: FAILURE_NOTICE_ACTOR });
    });

    it('shows a refused send that quoting itself never recorded', async () => {
      const quoteId = await quotedFor(await customerWithContacts(['buyer@example.com']));

      mail.failNextSubmissions(10);

      expect((await send(quoteId)).status).toBeGreaterThanOrEqual(500);

      mail.failNextSubmissions(0);

      const { body } = await sends(quoteId);

      expect(body.items).toHaveLength(2);
      const refused = body.items.find(
        (row: Record<string, unknown>) => row.audience === 'customer',
      );
      expect(refused).toMatchObject({
        outcome: 'failed',
        audience: 'customer',

        recipients: ['buyer@example.com'],
        actor: 'dev-sales',
      });

      expect(refused).not.toHaveProperty('failureReason');
    });

    it('emails the salesperson when the relay refuses the quote', async () => {
      const quoteId = await quotedFor(await customerWithContacts(['buyer@example.com']));
      const before = mail.submissions.length;

      mail.failNextSubmissions(1);

      expect((await send(quoteId)).status).toBeGreaterThanOrEqual(500);

      const notice = mail.submissions[before]!;
      expect(notice.mail.to).toEqual(['dev-sales@example.test']);
      expect(notice.mail.subject).toContain('did not go out');

      expect(notice.mail.subject).toMatch(/^An email about quote Q-\d{5,} did not go out$/);

      expect(notice.mail.textBody).toContain("The customer's copy of a quote you sent");
      expect(notice.mail.textBody).toContain('buyer@example.com');
      expect(notice.mail.textBody).toContain('could not be reached');
    });

    it('keeps the refusal after a later send succeeds', async () => {
      const quoteId = await quotedFor(await customerWithContacts(['buyer@example.com']));
      mail.failNextSubmissions(10);
      expect((await send(quoteId)).status).toBeGreaterThanOrEqual(500);
      mail.failNextSubmissions(0);

      expect((await send(quoteId)).status).toBe(200);

      const { body } = await sends(quoteId);
      const toCustomer = body.items.filter(
        (row: Record<string, unknown>) => row.audience === 'customer',
      );

      expect(toCustomer.map((row: Record<string, unknown>) => row.outcome)).toEqual([
        'accepted',
        'failed',
      ]);
    });

    it('is readable by every signed-in user, and by nobody else', async () => {
      const quoteId = await quotedFor(await customerWithContacts(['buyer@example.com']));

      expect((await sends(quoteId, noroles)).status).toBe(200);
      expect((await sends(quoteId, billing)).status).toBe(200);
      expect((await sends(quoteId, production)).status).toBe(200);
      expect((await http().get(`/quoting/quotes/${quoteId}/sends`)).status).toBe(401);
    });

    it('404s an unknown quote', async () => {
      expect(
        (await sales.get('/quoting/quotes/00000000-0000-4000-8000-000000000000/sends')).status,
      ).toBe(404);
    });
  });
});

describe('credit-hold approvals', () => {
  async function heldCustomer(): Promise<string> {
    const created = await sales
      .post('/crm/customers')
      .send({ billingAddress: QUOTABLE_BILLING_ADDRESS, name: 'Held Approvals Co' });
    expect(created.status).toBe(201);
    const id = created.body.id as string;
    expect(
      (
        await billing
          .put(`/crm/customers/${id}/credit-hold`)

          .send({ held: true, lockVersion: created.body.lockVersion })
      ).status,
    ).toBe(200);
    return id;
  }

  const ask = (customer: string, reason = 'PO already in hand') =>
    sales.post('/quoting/credit-approvals').send({ customerId: customer, reason });

  it('refuses a quote for a customer with no billing address, and says where to fix it', async () => {
    const created = await sales
      .post('/crm/customers')
      .send({ name: 'No Address Co', legacyAccountNumber: 'LA-Q-NOADDR' });
    expect(created.status).toBe(201);

    const response = await sales.post('/quoting/quotes').send({ customerId: created.body.id });

    expect(response.status).toBe(409);
    expect(response.body.reason).toBe('customer-billing-address-required');
    expect(response.body.value).toBe(created.body.id);
    expect(response.body.message).toMatch(/billing address/i);
  });

  it('allows the quote once the address is added, without anything else changing', async () => {
    const created = await sales
      .post('/crm/customers')
      .send({ name: 'Later Address Co', legacyAccountNumber: 'LA-Q-LATER' });
    expect(created.status).toBe(201);
    expect((await sales.post('/quoting/quotes').send({ customerId: created.body.id })).status).toBe(
      409,
    );

    const patched = await sales.patch(`/crm/customers/${created.body.id}`).send({
      billingAddress: QUOTABLE_BILLING_ADDRESS,
      lockVersion: created.body.lockVersion,
    });
    expect(patched.status).toBe(200);

    const after = await sales.post('/quoting/quotes').send({ customerId: created.body.id });
    expect(after.status).toBe(201);
  });

  it('refuses a customer with no billing address BEFORE spending a credit approval', async () => {
    const created = await sales
      .post('/crm/customers')
      .send({ name: 'Held No Address Co', legacyAccountNumber: 'LA-Q-HELDNOADDR' });
    expect(created.status).toBe(201);
    const id = created.body.id as string;

    const heldResponse = await billing
      .put(`/crm/customers/${id}/credit-hold`)
      .send({ held: true, lockVersion: created.body.lockVersion });
    expect(heldResponse.status).toBe(200);

    const asked = await ask(id);
    expect(asked.status).toBe(201);
    const decided = await billing
      .post(`/quoting/credit-approvals/${asked.body.id}/decision`)
      .send({ decision: 'approved' });
    expect(decided.status).toBe(201);

    const response = await sales.post('/quoting/quotes').send({ customerId: id });

    expect(response.status).toBe(409);
    expect(response.body.reason).toBe('customer-billing-address-required');

    const approvals = await billing.get('/quoting/credit-approvals');
    expect(approvals.status).toBe(200);
  });

  it('refuses a quote for a held customer, and names the approval path', async () => {
    const held = await heldCustomer();

    const response = await sales.post('/quoting/quotes').send({ customerId: held });

    expect(response.status).toBe(409);
    expect(response.body.reason).toBe('customer-on-credit-hold');

    expect(response.body.message).toMatch(/approve/i);
  });

  it('lets any signed-in user ask, and only Billing decide', async () => {
    const held = await heldCustomer();

    const asked = await ask(held);
    expect(asked.status).toBe(201);
    expect(asked.body).toMatchObject({ status: 'pending', requestedBy: 'dev-sales' });

    const bySales = await sales
      .post(`/quoting/credit-approvals/${asked.body.id}/decision`)
      .send({ decision: 'approved' });
    expect(bySales.status).toBe(403);

    const byBilling = await billing
      .post(`/quoting/credit-approvals/${asked.body.id}/decision`)
      .send({ decision: 'approved' });
    expect(byBilling.status).toBe(201);
    expect(byBilling.body).toMatchObject({ status: 'approved', decidedBy: 'dev-billing' });
  });

  it('spends the approval on exactly one quote, then blocks again', async () => {
    const held = await heldCustomer();
    const asked = await ask(held);
    await billing
      .post(`/quoting/credit-approvals/${asked.body.id}/decision`)
      .send({ decision: 'approved' });

    const first = await sales.post('/quoting/quotes').send({ customerId: held });
    const second = await sales.post('/quoting/quotes').send({ customerId: held });

    expect(first.status).toBe(201);

    expect(second.status).toBe(409);
    expect(second.body.reason).toBe('customer-on-credit-hold');
  });

  it('rejects with a required reason, and a rejection permits nothing', async () => {
    const held = await heldCustomer();
    const asked = await ask(held);

    expect(
      (
        await billing
          .post(`/quoting/credit-approvals/${asked.body.id}/decision`)
          .send({ decision: 'rejected' })
      ).status,
    ).toBe(400);

    const rejected = await billing
      .post(`/quoting/credit-approvals/${asked.body.id}/decision`)
      .send({ decision: 'rejected', reason: 'Balance is 90 days out' });
    expect(rejected.status).toBe(201);
    expect(rejected.body.decisionReason).toBe('Balance is 90 days out');

    expect((await sales.post('/quoting/quotes').send({ customerId: held })).status).toBe(409);
  });

  it('refuses to bank a second approval, and refuses one for an unheld customer', async () => {
    const held = await heldCustomer();
    const first = await ask(held);
    const second = await ask(held, 'asking again');
    await billing
      .post(`/quoting/credit-approvals/${first.body.id}/decision`)
      .send({ decision: 'approved' });

    const banked = await billing
      .post(`/quoting/credit-approvals/${second.body.id}/decision`)
      .send({ decision: 'approved' });
    expect(banked.status).toBe(409);
    expect(banked.body.reason).toBe('unspent-approval-exists');

    const unheld = await sales
      .post('/crm/customers')
      .send({ billingAddress: QUOTABLE_BILLING_ADDRESS, name: 'Perfectly Fine Co' });
    const pointless = await ask(unheld.body.id as string);
    expect(pointless.status).toBe(409);
    expect(pointless.body.reason).toBe('customer-not-on-credit-hold');
  });

  it('shows pending requests in the queue, and drops them once decided', async () => {
    const held = await heldCustomer();
    const asked = await ask(held);

    const queued = await noroles.get('/quoting/credit-approvals');

    expect(queued.status).toBe(200);
    expect(queued.body.items.map((row: { id: string }) => row.id)).toContain(asked.body.id);

    await billing
      .post(`/quoting/credit-approvals/${asked.body.id}/decision`)
      .send({ decision: 'approved' });

    const after = await noroles.get('/quoting/credit-approvals');
    expect(after.body.items.map((row: { id: string }) => row.id)).not.toContain(asked.body.id);
  });

  it("answers an account's approvals in every status, newest first", async () => {
    const held = await heldCustomer();
    const first = await ask(held, 'PO already in hand');
    const second = await ask(held, 'asking again');
    await billing
      .post(`/quoting/credit-approvals/${first.body.id}/decision`)
      .send({ decision: 'rejected', reason: 'Balance is 90 days out' });

    const standing = await sales.get(`/quoting/credit-approvals?customerId=${held}`);

    expect(standing.status).toBe(200);

    expect(standing.body.items.map((row: { id: string }) => row.id)).toEqual([
      second.body.id,
      first.body.id,
    ]);
    expect(standing.body.items[1]).toMatchObject({
      status: 'rejected',
      decisionReason: 'Balance is 90 days out',
    });
  });

  it('shows an approved token until a quote spends it', async () => {
    const held = await heldCustomer();
    const asked = await ask(held);
    await billing
      .post(`/quoting/credit-approvals/${asked.body.id}/decision`)
      .send({ decision: 'approved' });

    const before = await sales.get(`/quoting/credit-approvals?customerId=${held}`);

    expect(before.body.items[0]).toMatchObject({ status: 'approved' });
    expect(before.body.items[0].spentByQuoteId).toBeUndefined();

    const quote = await sales.post('/quoting/quotes').send({ customerId: held });
    expect(quote.status).toBe(201);

    const after = await sales.get(`/quoting/credit-approvals?customerId=${held}`);
    expect(after.body.items[0]).toMatchObject({
      status: 'approved',
      spentByQuoteId: quote.body.id,
    });
  });

  it('keeps the bare queue pending-only, and refuses an empty filter', async () => {
    const held = await heldCustomer();
    const asked = await ask(held);
    await billing
      .post(`/quoting/credit-approvals/${asked.body.id}/decision`)
      .send({ decision: 'rejected', reason: 'no' });

    const queue = await noroles.get('/quoting/credit-approvals');
    expect(queue.body.items.map((row: { id: string }) => row.id)).not.toContain(asked.body.id);
    const filtered = await noroles.get(`/quoting/credit-approvals?customerId=${held}`);
    expect(filtered.body.items.map((row: { id: string }) => row.id)).toContain(asked.body.id);

    const empty = await sales.get('/quoting/credit-approvals?customerId=');
    expect(empty.status).toBe(400);
    expect(empty.body.reason).toBe('empty-customer-id');
  });

  it('404s an unknown approval and 401s an anonymous caller', async () => {
    expect(
      (
        await billing
          .post('/quoting/credit-approvals/01988a00-0002-7000-8000-00000000dead/decision')
          .send({ decision: 'approved' })
      ).status,
    ).toBe(404);
    expect((await http().get('/quoting/credit-approvals')).status).toBe(401);
  });
});

describe('POST /quoting/quotes/:id/send — telling production', () => {
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

  async function customerWithContact(email: string): Promise<string> {
    const created = await sales
      .post('/crm/customers')
      .send({ billingAddress: QUOTABLE_BILLING_ADDRESS, name: `PM Alert ${email}` });
    expect(created.status).toBe(201);
    const id = created.body.id as string;
    const contact = await sales
      .post(`/crm/customers/${id}/contacts`)
      .send({ name: 'Buyer', email });
    expect(contact.status).toBe(201);

    const set = await sales
      .patch(`/crm/customers/${id}/contacts/${contact.body.id}`)
      .send({ roles: [...MAIL_CONTACT_ROLES], lockVersion: contact.body.lockVersion });
    expect(set.status, JSON.stringify(set.body)).toBe(200);
    return id;
  }

  async function quotedFor(customer: string) {
    const created = await sales.post('/quoting/quotes').send({ customerId: customer });
    expect(created.status).toBe(201);
    const quoteId = created.body.id as string;
    const priced = await putLines(sales, quoteId, [plainLine]);
    expect(priced.status).toBe(200);
    await setLeadTime(quoteId);
    expect(
      (
        await sales
          .post(`/quoting/quotes/${quoteId}/transition`)
          .send({ to: 'quoted', lockVersion: await lockVersionOf(quoteId) })
      ).status,
    ).toBe(200);
    return {
      quoteId,
      quoteNumber: created.body.quoteNumber as number,
      line: priced.body.lines[0] as Record<string, string>,
    };
  }

  const sendQuote = async (quoteId: string) =>
    sales
      .post(`/quoting/quotes/${quoteId}/send`)
      .send({ lockVersion: await lockVersionOf(quoteId) });

  it('sends the customer their quote and production a separate alert', async () => {
    await grant('dev-production-manager', ['ProductionManager'], 'pm@example.test');
    const customer = await customerWithContact('buyer@example.com');
    const { quoteId, quoteNumber, line } = await quotedFor(customer);
    const before = mail.submissions.length;

    const response = await sendQuote(quoteId);

    expect(response.status).toBe(200);

    const submitted = mail.submissions.slice(before);
    expect(submitted).toHaveLength(2);

    const [toCustomer, toProduction] = submitted;
    expect(toCustomer!.mail.to).toEqual(['buyer@example.com']);
    expect(toCustomer!.mail.attachments).toHaveLength(1);

    const reference = formatQuoteNumber(quoteNumber);
    expect(toCustomer!.mail.subject).toBe(`Quote ${reference} from ${DEMO_BRAND.name}`);
    expect(toCustomer!.mail.attachments?.[0]?.filename).toMatch(
      new RegExp(`^quote-${reference}-[0-9]{8}\\.pdf$`),
    );

    expect(toProduction!.mail.to).toEqual(['pm@example.test']);
    expect(toProduction!.mail.to).not.toContain('buyer@example.com');

    expect(toProduction!.mail.attachments ?? []).toHaveLength(0);

    expect(toProduction!.mail.subject).toContain(formatQuoteNumber(quoteNumber));
    expect(toProduction!.mail.subject).not.toContain(quoteId);
    expect(toProduction!.mail.textBody).toContain('dev-sales');
    expect(toProduction!.mail.textBody).toContain('rolls');

    for (const money of [
      line.extendedMargin,
      line.pricePerRoll,
      line.extendedPrice,
      line.extendedCost,
    ]) {
      expect(money).toMatch(/^\d+\.\d{4}$/);
      expect(toProduction!.mail.textBody).not.toContain(money);
    }

    expect(toCustomer!.mail.textBody).not.toContain(line.pricePerRoll);
  });

  it('resolves recipients through the role, not a hardcoded address', async () => {
    await grant('dev-production-manager', ['ProductionManager'], 'pm-one@example.test');
    await grant('dev-admin', ['ProductionManager'], 'pm-two@example.test');
    const customer = await customerWithContact('buyer2@example.com');
    const { quoteId } = await quotedFor(customer);
    const before = mail.submissions.length;

    expect((await sendQuote(quoteId)).status).toBe(200);

    const toProduction = mail.submissions.slice(before).at(-1)!;
    expect([...toProduction.mail.to].sort()).toEqual([
      'pm-one@example.test',
      'pm-two@example.test',
    ]);
  });

  it('still sends the quote when no ProductionManager has an address', async () => {
    await grant('dev-production-manager', ['ProductionManager']);
    await grant('dev-admin', ['Admin']);
    const customer = await customerWithContact('buyer3@example.com');
    const { quoteId } = await quotedFor(customer);
    const before = mail.submissions.length;

    const response = await sendQuote(quoteId);

    expect(response.status).toBe(200);
    expect(response.body.quoteId).toBe(quoteId);

    const submitted = mail.submissions.slice(before);
    expect(submitted[0]!.mail.to).toEqual(['buyer3@example.com']);

    expect(submitted).toHaveLength(2);
    expect(submitted[1]!.mail.to).toEqual(['dev-sales@example.test']);
    expect(submitted[1]!.mail.textBody).toContain(
      'The quote itself went to the customer as normal.',
    );
    expect(submitted[1]!.mail.textBody).toContain('no holder has an email address on record');

    expect(response.body.messageId).toBe(submitted[0]!.submission.messageId);
  });
});

describe('PUT /quoting/quotes/:id/lines - asking Production for a lead time', () => {
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

  async function draftFor(name: string) {
    const customer = await sales
      .post('/crm/customers')
      .send({ billingAddress: QUOTABLE_BILLING_ADDRESS, name: `Lead Time Ask ${name}` });
    expect(customer.status).toBe(201);
    const created = await sales.post('/quoting/quotes').send({ customerId: customer.body.id });
    expect(created.status).toBe(201);
    return {
      quoteId: created.body.id as string,
      quoteNumber: created.body.quoteNumber as number,
      customerName: `Lead Time Ask ${name}`,
    };
  }

  const asks = async (quoteId: string) =>
    (await sendLog.historyFor({ type: 'quote', id: quoteId })).filter(
      (row) => row.kind === 'lead-time-request',
    );

  it('asks every holder once, on the first priced save, and never again', async () => {
    await grant('dev-production-manager', ['ProductionManager'], 'pm@example.test');
    const { quoteId, quoteNumber, customerName } = await draftFor('first');
    const before = mail.submissions.length;

    const saved = await putLines(sales, quoteId, [plainLine]);

    expect(saved.status).toBe(200);
    const submitted = mail.submissions.slice(before);
    expect(submitted).toHaveLength(1);
    const alert = submitted[0]!.mail;
    expect(alert.to).toContain('pm@example.test');
    const reference = formatQuoteNumber(quoteNumber);
    expect(alert.subject).toBe(`${reference} needs a lead time`);
    expect(alert.textBody).toContain(reference);
    expect(alert.textBody).toContain(customerName);
    expect(alert.textBody).toContain('Sales rep: dev-sales');
    expect(alert.textBody).toContain('Lines: 1 line');

    expect(alert.textBody).not.toContain(saved.body.lines[0].pricePerRoll as string);

    const rows = await asks(quoteId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      audience: 'internal',
      outcome: 'accepted',
      actor: 'dev-sales',
      subjectLabel: reference,
    });

    const again = await putLines(sales, quoteId, [plainLine, plainLine]);
    expect(again.status).toBe(200);
    expect(mail.submissions.slice(before)).toHaveLength(1);
    expect(await asks(quoteId)).toHaveLength(1);
  });

  it('never asks about a quote that already has a lead time', async () => {
    await grant('dev-production-manager', ['ProductionManager'], 'pm@example.test');
    const { quoteId } = await draftFor('has-one');
    await setLeadTime(quoteId);
    const before = mail.submissions.length;

    expect((await putLines(sales, quoteId, [plainLine])).status).toBe(200);

    expect(mail.submissions.slice(before)).toHaveLength(0);
    expect(await asks(quoteId)).toHaveLength(0);
  });

  it('lists the request on the quote sends, and its date on the list', async () => {
    await grant('dev-production-manager', ['ProductionManager'], 'pm@example.test');
    const { quoteId } = await draftFor('listed');
    const { quoteId: untold } = await draftFor('untold');
    expect((await putLines(sales, quoteId, [plainLine])).status).toBe(200);

    const sends = await sales.get(`/quoting/quotes/${quoteId}/sends`);
    expect(sends.status).toBe(200);
    expect(sends.body.items).toHaveLength(1);
    expect(sends.body.items[0]).toMatchObject({
      kind: 'lead-time-request',
      audience: 'internal',
      outcome: 'accepted',
    });

    const list = await production.get('/quoting/quotes?leadTime=missing');
    expect(list.status).toBe(200);
    const items = list.body.items as { id: string; productionToldAt: string | null }[];
    expect(items.find((item) => item.id === quoteId)?.productionToldAt).toBe(
      sends.body.items[0].submittedAt,
    );
    expect(items.find((item) => item.id === untold)?.productionToldAt).toBeNull();
  });

  it('saves the lines when nobody holds the role, and records the gap once', async () => {
    await grant('dev-production-manager', ['Production']);
    await grant('dev-admin', ['Admin']);
    try {
      const { quoteId } = await draftFor('nobody');
      const before = mail.submissions.length;

      const saved = await putLines(sales, quoteId, [plainLine]);

      expect(saved.status).toBe(200);
      const rows = await asks(quoteId);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ outcome: 'failed', failureReason: 'no-holders' });

      const notices = mail.submissions.slice(before);
      expect(notices).toHaveLength(1);
      expect(notices[0]!.mail.to).toEqual(['dev-sales@example.test']);
      expect(notices[0]!.mail.textBody).toContain('Your lines were saved as normal.');

      expect((await putLines(sales, quoteId, [plainLine, plainLine])).status).toBe(200);
      expect(mail.submissions.slice(before)).toHaveLength(1);
      expect(await asks(quoteId)).toHaveLength(1);
    } finally {
      await grant('dev-production-manager', ['ProductionManager'], 'pm@example.test');
    }
  });

  it('saves the lines when the relay refuses the alert, and records a failed row', async () => {
    await grant('dev-production-manager', ['ProductionManager'], 'pm@example.test');
    const { quoteId } = await draftFor('refused');

    mail.failNextSubmissions(10);
    let saved;
    try {
      saved = await putLines(sales, quoteId, [plainLine]);
    } finally {
      mail.failNextSubmissions(0);
    }

    expect(saved.status).toBe(200);
    expect(saved.body.lines).toHaveLength(1);
    const rows = await asks(quoteId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.outcome).toBe('failed');
    expect(rows[0]).not.toHaveProperty('failureReason');
  });
});

describe('PUT /quoting/quotes/:id/lead-time', () => {
  async function draft(): Promise<string> {
    const quoteId = await createQuote(sales);
    expect((await putLines(sales, quoteId, [plainLine])).status).toBe(200);
    return quoteId;
  }

  it('records the days Production entered', async () => {
    const quoteId = await draft();

    const response = await production
      .put(`/quoting/quotes/${quoteId}/lead-time`)
      .send({ leadTimeDays: 14, lockVersion: await lockVersionOf(quoteId) });

    expect(response.status).toBe(200);
    expect(response.body.leadTimeDays).toBe(14);
  });

  it('stores who entered it from the session, never from the body', async () => {
    const quoteId = await draft();

    const response = await production.put(`/quoting/quotes/${quoteId}/lead-time`).send({
      leadTimeDays: 14,
      lockVersion: await lockVersionOf(quoteId),

      leadTimeSetBy: 'someone-else',
    });

    expect(response.status).toBe(200);
    expect(response.body.leadTimeSetBy).toBe('dev-production');
    expect(typeof response.body.leadTimeSetAt).toBe('string');
    const read = await sales.get(`/quoting/quotes/${quoteId}`);
    expect(read.body.leadTimeSetBy).toBe('dev-production');
    expect(read.body.leadTimeSetAt).toBe(response.body.leadTimeSetAt);
  });

  it('accepts zero, and does not confuse it with absent', async () => {
    const quoteId = await draft();

    const response = await production
      .put(`/quoting/quotes/${quoteId}/lead-time`)
      .send({ leadTimeDays: 0, lockVersion: await lockVersionOf(quoteId) });

    expect(response.status).toBe(200);
    expect(response.body.leadTimeDays).toBe(0);
  });

  it('is closed to Sales, who own every other quote edit', async () => {
    const quoteId = await draft();

    const response = await sales
      .put(`/quoting/quotes/${quoteId}/lead-time`)
      .send({ leadTimeDays: 14, lockVersion: await lockVersionOf(quoteId) });

    expect(response.status).toBe(403);
  });

  it('400s a negative or absurd lead time', async () => {
    const quoteId = await draft();
    const lockVersion = await lockVersionOf(quoteId);

    for (const leadTimeDays of [-1, 5270, 3.7]) {
      expect(
        (
          await production
            .put(`/quoting/quotes/${quoteId}/lead-time`)
            .send({ leadTimeDays, lockVersion })
        ).status,
        String(leadTimeDays),
      ).toBe(400);
    }
  });

  it('409s figures the caller never read', async () => {
    const quoteId = await draft();

    const response = await production
      .put(`/quoting/quotes/${quoteId}/lead-time`)
      .send({ leadTimeDays: 14, lockVersion: 999 });

    expect(response.status).toBe(409);
    expect(response.body.reason).toBe('stale-aggregate');
  });

  it('404s a quote that does not exist', async () => {
    expect(
      (
        await production
          .put('/quoting/quotes/01988a00-0100-7000-8000-0000000000ee/lead-time')
          .send({ leadTimeDays: 14, lockVersion: 1 })
      ).status,
    ).toBe(404);
  });
});

describe('the lead-time gate on going to a client', () => {
  async function pricedDraft(): Promise<string> {
    const quoteId = await createQuote(sales);
    expect((await putLines(sales, quoteId, [plainLine])).status).toBe(200);
    await quotingStores.quotes.transition(quoteId, 'quoted', new Date());
    return quoteId;
  }

  it('refuses to SEND a quote with no lead time, before it is ever quoted', async () => {
    const quoteId = await createQuote(sales);
    expect((await putLines(sales, quoteId, [plainLine])).status).toBe(200);

    const response = await sales
      .post(`/quoting/quotes/${quoteId}/transition`)
      .send({ to: 'quoted', lockVersion: await lockVersionOf(quoteId) });

    expect(response.status).toBe(409);
    expect(response.body.reason).toBe('quote-needs-lead-time');
    expect((await sales.get(`/quoting/quotes/${quoteId}`)).body.status).toBe('draft');
  });

  it('refuses to RENDER a quote with no lead time, naming the reason', async () => {
    const quoteId = await pricedDraft();

    const response = await sales.get(`/quoting/quotes/${quoteId}/document`);

    expect(response.status).toBe(409);
    expect(response.body.reason).toBe('quote-has-no-lead-time');
  });

  it('refuses to SEND one, with the same named reason', async () => {
    const quoteId = await pricedDraft();

    const response = await sales
      .post(`/quoting/quotes/${quoteId}/send`)
      .send({ lockVersion: await lockVersionOf(quoteId) });

    expect(response.status).toBe(409);
    expect(response.body.reason).toBe('quote-has-no-lead-time');
  });

  it('lets both through once Production has entered one', async () => {
    const quoteId = await createQuote(sales);
    expect((await putLines(sales, quoteId, [plainLine])).status).toBe(200);
    await setLeadTime(quoteId, 12);
    expect(
      (
        await sales
          .post(`/quoting/quotes/${quoteId}/transition`)
          .send({ to: 'quoted', lockVersion: await lockVersionOf(quoteId) })
      ).status,
    ).toBe(200);

    expect((await sales.get(`/quoting/quotes/${quoteId}/document`).buffer()).status).toBe(200);
  });
});

describe('Quoting edge — changing the pricing constants', () => {
  it('lets Billing move the margin floor, and reads it back', async () => {
    const patched = await billing.patch('/quoting/config').send({ marginFloorPct: '0.165000' });
    expect(patched.status).toBe(200);
    expect(patched.body.marginFloorPct).toBe('0.165000');

    const reread = await billing.get('/quoting/config');
    expect(reread.body.marginFloorPct).toBe('0.165000');

    await billing.patch('/quoting/config').send({ marginFloorPct: '0.120000' });
  });

  it('refuses a percent typed as a ratio with 400, not the CHECK constraint 500', async () => {
    const refused = await billing.patch('/quoting/config').send({ marginFloorPct: '15' });
    expect(refused.status).toBe(400);

    expect((await billing.get('/quoting/config')).body.marginFloorPct).toBe('0.120000');
  });

  it('refuses a negative waste, and takes a surcharge above 1', async () => {
    expect((await billing.patch('/quoting/config').send({ wastePct: '-0.026000' })).status).toBe(
      400,
    );
    expect((await billing.patch('/quoting/config').send({ wastePct: '1.000000' })).status).toBe(
      400,
    );

    const wide = await billing.patch('/quoting/config').send({ overwrapSurchargePct: '1.250000' });
    expect(wide.status).toBe(200);
    await billing.patch('/quoting/config').send({ overwrapSurchargePct: '0.040000' });
  });

  it('refuses a surcharge wider than its column, rather than a 22003 500', async () => {
    expect(
      (await billing.patch('/quoting/config').send({ overwrapSurchargePct: '999.999999' })).status,
    ).toBe(200);
    await billing.patch('/quoting/config').send({ overwrapSurchargePct: '0.040000' });

    expect(
      (await billing.patch('/quoting/config').send({ overwrapSurchargePct: '1000.000000' })).status,
    ).toBe(400);
    expect((await billing.get('/quoting/config')).body.overwrapSurchargePct).toBe('0.040000');
  });

  it('stamps who changed it from the session, not the body', async () => {
    const patched = await billing
      .patch('/quoting/config')
      .send({ wastePct: '0.021000', updatedBy: 'someone-else' });

    expect(patched.status).toBe(200);
    expect(patched.body.updatedBy).toBe('dev-billing');

    await billing.patch('/quoting/config').send({ wastePct: '0.020000' });
  });

  it('refuses Sales and anonymous callers', async () => {
    expect((await sales.patch('/quoting/config').send({ marginFloorPct: '0.035000' })).status).toBe(
      403,
    );
    expect((await noroles.patch('/quoting/config').send({ wastePct: '0.035000' })).status).toBe(
      403,
    );
    expect((await http().patch('/quoting/config').send({ wastePct: '0.035000' })).status).toBe(401);
  });

  it('rejects a value the schema refuses, without changing anything', async () => {
    const before = (await billing.get('/quoting/config')).body.wastePct;

    expect((await billing.patch('/quoting/config').send({ wastePct: 0.13 })).status).toBe(400);
    expect((await billing.get('/quoting/config')).body.wastePct).toBe(before);
  });

  it('leaves unnamed fields alone', async () => {
    const before = (await billing.get('/quoting/config')).body;
    const patched = await billing.patch('/quoting/config').send({ palletCost: '13.5000' });

    expect(patched.status).toBe(200);
    expect(patched.body.palletCost).toBe('13.5000');
    expect(patched.body.ourVehicleFreightRate).toBe(before.ourVehicleFreightRate);
    expect(patched.body.poundsPerTonne).toBe(before.poundsPerTonne);

    await billing.patch('/quoting/config').send({ palletCost: before.palletCost });
  });
});

describe('Quoting edge - a pricing constant wider than its column', () => {
  it('400s each scale rather than letting PostgreSQL answer 22003', async () => {
    for (const [field, value] of [
      ['palletCost', '1000000000000000'],
      ['plugCostPerPlug', '10000'],
      ['poundsPerTonne', '10000'],
      ['coreCostPerCore', '1000000000000000'],
      ['coreReferenceLengthIn', '100000000'],
      ['ourVehicleFreightRate', '1000000000000000'],
    ] as const) {
      const refused = await billing.patch('/quoting/config').send({ [field]: value });

      expect(refused.status, field).toBe(400);

      expect(refused.body.fieldErrors[field], field).toBeDefined();
    }
  });

  it('still takes the figures the shop actually uses', async () => {
    expect(
      (
        await billing
          .patch('/quoting/config')
          .send({ plugCostPerPlug: '0.05000000', poundsPerTonne: '2204.62262185' })
      ).status,
    ).toBe(200);
  });
});

describe('Quoting edge - the pricing-config change history', () => {
  it('records a change with who made it and the values it replaced', async () => {
    const before = (await billing.get('/quoting/config')).body.overwrapSurchargePct;
    await billing.patch('/quoting/config').send({ overwrapSurchargePct: '0.067000' });

    const history = await billing.get('/quoting/config/history');
    expect(history.status).toBe(200);
    const [entry] = history.body.items;
    expect(entry.actor).toBe('dev-billing');

    expect(entry.overwrapSurchargePct).toBe(before);
    expect((await billing.get('/quoting/config')).body.overwrapSurchargePct).toBe('0.067000');

    await billing.patch('/quoting/config').send({ overwrapSurchargePct: before });
  });

  it('returns newest first', async () => {
    await billing.patch('/quoting/config').send({ palletCost: '14.5000' });
    await billing.patch('/quoting/config').send({ palletCost: '12.0000' });

    const items = (await billing.get('/quoting/config/history')).body.items;

    expect(items[0].palletCost).toBe('14.5000');
    expect(items[1].palletCost).toBe('10.0000');

    await billing.patch('/quoting/config').send({ palletCost: '10.0000' });
  });

  it('is read-open to any signed-in user, and refuses anonymous', async () => {
    expect((await sales.get('/quoting/config/history')).status).toBe(200);
    expect((await noroles.get('/quoting/config/history')).status).toBe(200);
    expect((await http().get('/quoting/config/history')).status).toBe(401);
  });

  it('writes the history in the same transaction as the change', async () => {
    const countBefore = (await billing.get('/quoting/config/history')).body.items.length;
    expect((await billing.patch('/quoting/config').send({ wastePct: 0.13 })).status).toBe(400);

    expect((await billing.get('/quoting/config/history')).body.items).toHaveLength(countBefore);
  });
});

describe('Quoting edge - a jurisdiction must belong to the ship-to state', () => {
  beforeAll(async () => {
    await quotingStores.taxRates.importRates([
      {
        jurisdiction: 'WA-9034',
        rate: '0.087500',
        effectiveFrom: '2026-10-01',
        source: 'wa_dor',
        name: 'SAMPLE CITY',
      },
    ]);
  });

  it('422s a Washington jurisdiction on an Oregon delivery, naming both', async () => {
    const quoteId = await createQuote(sales);

    const response = await putLines(sales, quoteId, [
      {
        ...plainLine,
        taxTreatment: { taxStatus: 'wa_tax', taxJurisdiction: 'WA-9034' },
        deliveryAddress: {
          line1: '1 Riverside',
          city: 'Demo Port',
          state: 'OR',
          postalCode: '97000',
        },
      },
    ]);

    expect(response.status).toBe(422);
    expect(response.body).toMatchObject({
      reason: 'line-jurisdiction-mismatch',
      value: { lineNumber: 1, taxJurisdiction: 'WA-9034', shipToState: 'OR' },
    });
  });

  it('saves the same line once its jurisdiction matches the destination', async () => {
    const quoteId = await createQuote(sales);

    const response = await putLines(sales, quoteId, [
      {
        ...plainLine,
        taxTreatment: { taxStatus: 'wa_tax', taxJurisdiction: 'WA-9034' },
        deliveryAddress: {
          line1: '400 Warehouse Way',
          city: 'Sample Harbor',
          state: 'WA',
          postalCode: '98000',
        },
      },
    ]);

    expect(response.status).toBe(200);
  });

  it('accepts a non-taxable line to a state Demo Printworks does not tax', async () => {
    const quoteId = await createQuote(sales);

    const response = await putLines(sales, quoteId, [
      {
        ...plainLine,
        taxTreatment: { taxStatus: 'non_tax' },
        deliveryAddress: {
          line1: '1 Riverside',
          city: 'Demo Port',
          state: 'OR',
          postalCode: '97000',
        },
      },
    ]);

    expect(response.status).toBe(200);
  });
});

describe('Quoting edge - a tax jurisdiction must be a key with a rate loaded', () => {
  const inWashington = (taxJurisdiction: string) => ({
    ...plainLine,
    taxTreatment: { taxStatus: 'wa_tax', taxJurisdiction },
    deliveryAddress: {
      line1: '400 Warehouse Way',
      city: 'Sample Harbor',
      state: 'WA',
      postalCode: '98000',
    },
  });

  it('400s a bare state, with the sentence that gives the format', async () => {
    const quoteId = await createQuote(sales);

    const response = await putLines(sales, quoteId, [inWashington('WA')]);

    expect(response.status).toBe(400);
    expect(JSON.stringify(response.body)).toContain(
      'tax jurisdiction must be ID, or WA- and the four-digit DOR location code, ' +
        'such as WA-0202 for Clarkston.',
    );
  });

  it('422s a key no rate is loaded for, naming the line and the key', async () => {
    const quoteId = await createQuote(sales);

    const response = await putLines(sales, quoteId, [plainLine, inWashington('WA-2717')]);

    expect(response.status).toBe(422);
    expect(response.body).toMatchObject({
      reason: 'unknown-tax-jurisdiction',
      value: { lineNumber: 2, taxJurisdiction: 'WA-2717' },
    });

    const fetched = await sales.get(`/quoting/quotes/${quoteId}`);
    expect(fetched.body.lines).toHaveLength(0);
  });
});

describe('POST /quoting/quotes/:id/transition to quoted sends nothing', () => {
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

  async function acceptedDraft(email: string): Promise<string> {
    const customer = await sales
      .post('/crm/customers')
      .send({ billingAddress: QUOTABLE_BILLING_ADDRESS, name: `Accepted By PO ${email}` });
    expect(customer.status).toBe(201);
    const contact = await sales
      .post(`/crm/customers/${customer.body.id}/contacts`)
      .send({ name: 'Buyer', email });
    expect(contact.status).toBe(201);
    const tagged = await sales
      .patch(`/crm/customers/${customer.body.id}/contacts/${contact.body.id}`)
      .send({ roles: [...MAIL_CONTACT_ROLES], lockVersion: contact.body.lockVersion });
    expect(tagged.status, JSON.stringify(tagged.body)).toBe(200);

    const created = await sales.post('/quoting/quotes').send({ customerId: customer.body.id });
    expect(created.status).toBe(201);
    const quoteId = created.body.id as string;

    await setLeadTime(quoteId);
    expect((await putLines(sales, quoteId, [plainLine])).status).toBe(200);
    return quoteId;
  }

  const markQuoted = async (quoteId: string) =>
    sales
      .post(`/quoting/quotes/${quoteId}/transition`)
      .send({ to: 'quoted', lockVersion: await lockVersionOf(quoteId) });

  it('moves the quote to quoted and emails nobody, records no send, alerts nobody', async () => {
    await grant('dev-production-manager', ['ProductionManager'], 'pm@example.test');
    const quoteId = await acceptedDraft('accepted-buyer@example.com');
    const before = mail.submissions.length;

    const moved = await markQuoted(quoteId);

    expect(moved.status).toBe(200);
    expect(moved.body.status).toBe('quoted');

    expect(mail.submissions.slice(before)).toHaveLength(0);

    const sends = await sales.get(`/quoting/quotes/${quoteId}/sends`);
    expect(sends.status).toBe(200);
    expect(sends.body.items).toEqual([]);
  });

  it('can still be emailed later, as a first send that asks for no confirmation', async () => {
    await grant('dev-production-manager', ['ProductionManager'], 'pm@example.test');
    const quoteId = await acceptedDraft('later-buyer@example.com');
    expect((await markQuoted(quoteId)).status).toBe(200);
    const before = mail.submissions.length;

    const sent = await sales
      .post(`/quoting/quotes/${quoteId}/send`)
      .send({ lockVersion: await lockVersionOf(quoteId) });

    expect(sent.status, JSON.stringify(sent.body)).toBe(200);
    const submitted = mail.submissions.slice(before);
    expect(submitted[0]?.mail.to).toEqual(['later-buyer@example.com']);
    expect(submitted[0]?.mail.attachments).toHaveLength(1);
    const sends = await sales.get(`/quoting/quotes/${quoteId}/sends`);
    expect(
      sends.body.items.filter((row: Record<string, unknown>) => row.audience === 'customer'),
    ).toHaveLength(1);
  });
});
