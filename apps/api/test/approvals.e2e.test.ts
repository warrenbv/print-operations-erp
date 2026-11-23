// End-to-end over HTTP: GET /approvals/pending composes credit-hold exceptions and parked quotes, and drops each once decided.
import { DEV_USERNAMES } from '@erp/identity';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { applyRequestParsing } from '../src/config/request-parsing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { pendingApprovalListResponseSchema, type PendingApproval } from '@erp/types';

const DEV_PASSWORD = 'dev-password';
const BREAK_GLASS_PASSWORD = 'sealed-emergency-password';

process.env.NODE_ENV = 'test';
process.env.AUTH_PROVIDER = 'local';
process.env.DATA_PERSISTENCE = 'memory';
process.env.LOCAL_AUTH_PASSWORD = DEV_PASSWORD;
process.env.LOCAL_AUTH_USERS = DEV_USERNAMES.join(',');
process.env.BREAK_GLASS_DEV_PASSWORD = BREAK_GLASS_PASSWORD;
process.env.SESSION_COOKIE_INSECURE = 'true';

const QUOTABLE_BILLING_ADDRESS = {
  line1: '1 Test Way',
  city: 'Demo Falls',
  state: 'ID',
  postalCode: '83010',
};

const KRAFT_37_ID = 'grade-kraft-37';

const plainLine = {
  gradeId: KRAFT_37_ID,
  footageVariant: 'long',
  rollWidthIn: 12,
  quantityRolls: 10,
  taxTreatment: { taxStatus: 'id_tax', taxJurisdiction: 'ID' },
};

let app: INestApplication;
let sales: request.Agent;
let billing: request.Agent;
let customerA: string;

function http(): request.Agent {
  return request(app.getHttpServer());
}

async function loginAgent(username: string, password: string): Promise<request.Agent> {
  const agent = request.agent(app.getHttpServer());
  const response = await agent.post('/auth/login').send({ username, password });
  expect(response.status).toBe(200);
  return agent;
}

async function createQuote(customerId: string): Promise<string> {
  const created = await sales.post('/quoting/quotes').send({ customerId });
  expect(created.status).toBe(201);
  return created.body.id as string;
}

async function overrideRequestedQuote(
  customerId: string,
  pricePerRoll = '12.0000',
): Promise<string> {
  const quoteId = await createQuote(customerId);
  const priced = await sales.put(`/quoting/quotes/${quoteId}/lines`).send({
    lockVersion: await quoteLockVersion(quoteId),
    lines: [{ ...plainLine, overridePricePerRoll: pricePerRoll }],
  });
  expect(priced.status).toBe(200);
  const parked = await sales
    .post(`/quoting/quotes/${quoteId}/transition`)
    .send({ to: 'override_requested', lockVersion: await quoteLockVersion(quoteId) });
  expect(parked.status).toBe(200);
  return quoteId;
}

async function creditHoldAsk(): Promise<{ customerId: string; approvalId: string }> {
  const created = await sales
    .post('/crm/customers')
    .send({ billingAddress: QUOTABLE_BILLING_ADDRESS, name: 'Held Inbox Co' });
  expect(created.status).toBe(201);
  const customerId = created.body.id as string;
  expect(
    (
      await billing
        .put(`/crm/customers/${customerId}/credit-hold`)
        .send({ held: true, lockVersion: created.body.lockVersion })
    ).status,
  ).toBe(200);
  const asked = await sales
    .post('/quoting/credit-approvals')
    .send({ customerId, reason: 'PO already in hand' });
  expect(asked.status).toBe(201);
  return { customerId, approvalId: asked.body.id as string };
}

async function readInbox(): Promise<PendingApproval[]> {
  const response = await sales.get('/approvals/pending');
  expect(response.status).toBe(200);

  return pendingApprovalListResponseSchema.parse(response.body).items;
}

beforeAll(async () => {
  const { AuthModule } = await import('../src/auth/auth.module');
  const { AdminModule } = await import('../src/admin/admin.module');
  const { CrmModule } = await import('../src/crm/crm.module');
  const { QuotingModule } = await import('../src/quoting/quoting.module');
  const { OrdersModule } = await import('../src/orders/orders.module');
  const { ApprovalsModule } = await import('../src/approvals/approvals.module');
  const { QUOTING_STORES } = await import('../src/quoting/quoting.factory');

  const moduleRef = await Test.createTestingModule({
    imports: [AuthModule, AdminModule, CrmModule, QuotingModule, OrdersModule, ApprovalsModule],
  }).compile();
  app = moduleRef.createNestApplication();
  applyRequestParsing(app);
  app.use(cookieParser());
  await app.listen(0, '127.0.0.1');

  const stores =
    moduleRef.get<import('../src/quoting/quoting.factory').QuotingStores>(QUOTING_STORES);
  const now = new Date();
  await stores.grades.create({
    id: KRAFT_37_ID,
    productFamily: 'kraft',
    code: '37#',
    basisWeightLb: '37.0000',
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
  ] as const) {
    const grant = await admin.put(`/admin/users/local:${username}/roles`).send({
      identity: { externalId: `local:${username}`, username, displayName: username },
      roles,
    });
    expect(grant.status).toBe(200);
  }
  sales = await loginAgent('dev-sales', DEV_PASSWORD);
  billing = await loginAgent('dev-billing', DEV_PASSWORD);

  const a = await sales.post('/crm/customers').send({
    billingAddress: QUOTABLE_BILLING_ADDRESS,
    name: 'Approvals E2E Alpha Co',
    legacyAccountNumber: 'LA-APR-A',
  });
  expect(a.status).toBe(201);
  customerA = a.body.id;
});

afterAll(async () => {
  await app.close();
});

async function quoteLockVersion(quoteId: string): Promise<number> {
  const current = await sales.get(`/quoting/quotes/${quoteId}`);
  expect(current.status).toBe(200);
  return current.body.lockVersion as number;
}

describe('GET /approvals/pending', () => {
  it('rejects an anonymous request (SessionGuard)', async () => {
    expect((await http().get('/approvals/pending')).status).toBe(401);
  });

  it('composes both kinds into one schema-valid list', async () => {
    const { customerId: heldId, approvalId } = await creditHoldAsk();
    const quoteId = await overrideRequestedQuote(customerA);

    const items = await readInbox();

    expect(
      items.find((item) => item.kind === 'credit-hold' && item.approvalId === approvalId),
    ).toMatchObject({ customerId: heldId, reason: 'PO already in hand', requestedBy: 'dev-sales' });

    const override = items.find(
      (item) => item.kind === 'price-override' && item.quoteId === quoteId,
    );
    expect(override).toMatchObject({ customerId: customerA, versionNumber: 1 });
  });

  it('drops an item once its own edge decides it', async () => {
    const { approvalId } = await creditHoldAsk();
    const quoteId = await overrideRequestedQuote(customerA);

    const decided = await billing
      .post(`/quoting/credit-approvals/${approvalId}/decision`)
      .send({ decision: 'approved' });

    expect(decided.status).toBe(201);

    const current = await billing.get(`/quoting/quotes/${quoteId}`);
    expect(current.status).toBe(200);
    const rejected = await billing
      .post(`/quoting/quotes/${quoteId}/override/reject`)
      .send({ lockVersion: current.body.lockVersion, reason: 'price it at tier' });
    expect(rejected.status).toBe(200);

    const items = await readInbox();
    expect(
      items.some((item) => item.kind === 'credit-hold' && item.approvalId === approvalId),
    ).toBe(false);
    expect(items.some((item) => item.kind === 'price-override' && item.quoteId === quoteId)).toBe(
      false,
    );
  });

  it('returns price overrides oldest first', async () => {
    const older = await overrideRequestedQuote(customerA);
    const newer = await overrideRequestedQuote(customerA);

    const overrides = (await readInbox()).filter((item) => item.kind === 'price-override');
    const olderAt = overrides.findIndex((item) => item.quoteId === older);
    const newerAt = overrides.findIndex((item) => item.quoteId === newer);
    expect(olderAt).toBeGreaterThanOrEqual(0);
    expect(newerAt).toBeGreaterThan(olderAt);
  });

  describe('what each parked quote needs decided', () => {
    function needsOf(items: readonly PendingApproval[], quoteId: string): readonly string[] {
      const item = items.find((i) => i.kind === 'price-override' && i.quoteId === quoteId);
      if (item?.kind !== 'price-override') throw new Error(`quote ${quoteId} is not in the inbox`);
      return item.needs;
    }

    it('names the hand-set price, the floor, or both', async () => {
      const priceOnly = await overrideRequestedQuote(customerA);
      const both = await overrideRequestedQuote(customerA, '3.8500');

      const items = await readInbox();

      expect(needsOf(items, priceOnly)).toEqual(['price']);
      expect(needsOf(items, both)).toEqual(['price', 'floor']);
    });

    it('shrinks after one decision, and the quote leaves once nothing is owed', async () => {
      const admin = await loginAgent('break-glass', BREAK_GLASS_PASSWORD);
      const quoteId = await overrideRequestedQuote(customerA, '3.8500');

      const floor = await admin
        .post(`/quoting/quotes/${quoteId}/floor-override/approve`)
        .send({ lockVersion: await quoteLockVersion(quoteId), reason: 'strategic account' });
      expect(floor.status).toBe(200);
      expect(needsOf(await readInbox(), quoteId)).toEqual(['price']);

      const price = await billing
        .post(`/quoting/quotes/${quoteId}/override/approve`)
        .send({ lockVersion: await quoteLockVersion(quoteId) });
      expect(price.status).toBe(200);
      expect(
        (await readInbox()).some((i) => i.kind === 'price-override' && i.quoteId === quoteId),
      ).toBe(false);
    });

    it('leaves out a parked quote that owes nothing', async () => {
      const quoteId = await createQuote(customerA);
      expect(
        (
          await sales
            .put(`/quoting/quotes/${quoteId}/lines`)
            .send({ lockVersion: await quoteLockVersion(quoteId), lines: [plainLine] })
        ).status,
      ).toBe(200);
      const parked = await sales
        .post(`/quoting/quotes/${quoteId}/transition`)
        .send({ to: 'override_requested', lockVersion: await quoteLockVersion(quoteId) });
      expect(parked.status).toBe(200);

      expect(
        (await readInbox()).some((i) => i.kind === 'price-override' && i.quoteId === quoteId),
      ).toBe(false);
    });
  });
});
