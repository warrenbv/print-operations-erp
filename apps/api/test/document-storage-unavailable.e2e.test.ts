// End-to-end over HTTP: a document store that cannot write answers 503 with its reason, and the log carries no query string.
import { DEV_USERNAMES } from '@erp/identity';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { applyRequestParsing } from '../src/config/request-parsing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  InMemoryStoredDocumentRepository,
  LocalFileDocumentStore,
  systemClock,
} from '@erp/documents';
import type { DocumentsStores } from '../src/documents/documents.factory';
import type { QuotingStores } from '../src/quoting/quoting.factory';

const DEV_PASSWORD = 'dev-password';
const BREAK_GLASS_PASSWORD = 'sealed-emergency-password';
const KRAFT_37_ID = 'grade-kraft-37';

process.env.NODE_ENV = 'test';
process.env.AUTH_PROVIDER = 'local';
process.env.DATA_PERSISTENCE = 'memory';
process.env.LOCAL_AUTH_PASSWORD = DEV_PASSWORD;
process.env.LOCAL_AUTH_USERS = DEV_USERNAMES.join(',');
process.env.BREAK_GLASS_DEV_PASSWORD = BREAK_GLASS_PASSWORD;
process.env.SESSION_COOKIE_INSECURE = 'true';

const UNAVAILABLE_ON_WRITE = {
  reason: 'document-storage-unavailable',
  value: 'not-a-directory',
  message:
    'the ERP could not write this document to its document storage. Tell IT: document storage.',
};

let app: INestApplication;
let scratch: string;
let sales: request.Agent;
let production: request.Agent;
let customerId: string;

async function loginAgent(username: string, password: string): Promise<request.Agent> {
  const agent = request.agent(app.getHttpServer());
  const response = await agent.post('/auth/login').send({ username, password });
  expect(response.status).toBe(200);
  return agent;
}

async function lockVersionOf(path: string): Promise<number> {
  const current = await sales.get(path);
  expect(current.status).toBe(200);
  return current.body.lockVersion as number;
}

async function quotedQuote(): Promise<string> {
  const created = await sales.post('/quoting/quotes').send({ customerId });
  expect(created.status).toBe(201);
  const id = created.body.id as string;
  const path = `/quoting/quotes/${id}`;

  const lines = await sales.put(`${path}/lines`).send({
    lines: [
      {
        gradeId: KRAFT_37_ID,
        footageVariant: 'long',
        rollWidthIn: 12,
        quantityRolls: 10,
        taxTreatment: { taxStatus: 'id_tax', taxJurisdiction: 'ID' },
      },
    ],
    lockVersion: await lockVersionOf(path),
  });
  expect(lines.status).toBe(200);

  const leadTime = await production
    .put(`${path}/lead-time`)
    .send({ leadTimeDays: 10, lockVersion: await lockVersionOf(path) });
  expect(leadTime.status).toBe(200);

  const moved = await sales
    .post(`${path}/transition`)
    .send({ to: 'quoted', lockVersion: await lockVersionOf(path) });
  expect(moved.status).toBe(200);
  return id;
}

function captureStorageLog(): {
  lines: () => Record<string, unknown>[];
  everything: () => string;
  restore: () => void;
} {
  const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  return {
    lines: () =>
      spy.mock.calls
        .map(([first]) => (typeof first === 'string' ? first : ''))
        .filter((text) => text.includes('document_storage_failed'))
        .map((text) => JSON.parse(text) as Record<string, unknown>),

    everything: () =>
      spy.mock.calls
        .flat()
        .map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg)))
        .join('\n'),
    restore: () => spy.mockRestore(),
  };
}

beforeAll(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'erp-392-'));
  await writeFile(join(scratch, 'plain'), 'a file where the storage root expects a directory');

  const { AuthModule } = await import('../src/auth/auth.module');
  const { AdminModule } = await import('../src/admin/admin.module');
  const { CrmModule } = await import('../src/crm/crm.module');
  const { QuotingModule } = await import('../src/quoting/quoting.module');
  const { OrdersModule } = await import('../src/orders/orders.module');
  const { QUOTING_STORES } = await import('../src/quoting/quoting.factory');
  const { DOCUMENTS_STORES } = await import('../src/documents/documents.factory');
  const { MAIL_SINK, SEND_LOG } = await import('../src/notifications/notifications.factory');
  const {
    InMemoryMailSink,
    InMemorySendLog,
    systemClock: mailClock,
  } = await import('@erp/notifications');

  const brokenStores: DocumentsStores = {
    store: new LocalFileDocumentStore(join(scratch, 'plain', 'documents')),
    documents: new InMemoryStoredDocumentRepository(systemClock),
    close: async () => undefined,
  };

  const moduleRef = await Test.createTestingModule({
    imports: [AuthModule, AdminModule, CrmModule, QuotingModule, OrdersModule],
  })
    .overrideProvider(DOCUMENTS_STORES)
    .useValue(brokenStores)
    .overrideProvider(MAIL_SINK)
    .useValue(new InMemoryMailSink(mailClock))
    .overrideProvider(SEND_LOG)
    .useValue(new InMemorySendLog())
    .compile();
  app = moduleRef.createNestApplication();
  applyRequestParsing(app);
  app.use(cookieParser());
  await app.listen(0, '127.0.0.1');

  const stores = moduleRef.get<QuotingStores>(QUOTING_STORES);
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

  sales = await loginAgent('dev-sales', DEV_PASSWORD);
  production = await loginAgent('dev-production', DEV_PASSWORD);
  const admin = await loginAgent('break-glass', BREAK_GLASS_PASSWORD);
  for (const [username, roles] of [
    ['dev-sales', ['Sales']],
    ['dev-production', ['Production']],
  ] as const) {
    const grant = await admin.put(`/admin/users/local:${username}/roles`).send({
      identity: { externalId: `local:${username}`, username, displayName: username },
      roles,
    });
    expect(grant.status).toBe(200);
  }

  const customer = await sales.post('/crm/customers').send({
    name: 'Storage 503 Co',
    billingAddress: { line1: '1 Test Way', city: 'Demo Falls', state: 'ID', postalCode: '83010' },
  });
  expect(customer.status).toBe(201);
  customerId = customer.body.id as string;
});

afterAll(async () => {
  await app?.close();
  if (scratch !== undefined) await rm(scratch, { recursive: true, force: true });
});

describe('a document store that cannot write', () => {
  it('answers GET /quoting/quotes/:id/document with 503 and the reason, not 500', async () => {
    const quoteId = await quotedQuote();

    const log = captureStorageLog();
    try {
      const response = await sales.get(`/quoting/quotes/${quoteId}/document`);

      expect(response.status).toBe(503);
      expect(response.body).toEqual(UNAVAILABLE_ON_WRITE);
      expect(log.lines()).toEqual([
        expect.objectContaining({
          operation: 'put',
          code: 'not-a-directory',
          url: `/quoting/quotes/${quoteId}/document`,
          storagePath: expect.stringMatching(/^quote\/\d{4}\/\d{2}\//),
        }),
      ]);
    } finally {
      log.restore();
    }
  });

  it('logs the path and never the query string', async () => {
    const quoteId = await quotedQuote();

    const sentinel = 'zz473sentinel';
    const path = `/quoting/quotes/${quoteId}/document`;

    const log = captureStorageLog();
    try {
      const response = await sales.get(`${path}?q=${sentinel}&limit=20`);

      expect(response.status).toBe(503);
      expect(response.body).toEqual(UNAVAILABLE_ON_WRITE);

      expect(log.lines()).toEqual([
        expect.objectContaining({
          kind: 'documents',
          event: 'document_storage_failed',
          operation: 'put',
          code: 'not-a-directory',
          systemCode: 'ENOTDIR',
          method: 'GET',
          url: path,
          storagePath: expect.stringMatching(/^quote\/\d{4}\/\d{2}\//),
        }),
      ]);
      const everything = log.everything();
      expect(everything).not.toContain(sentinel);
      expect(everything).not.toMatch(/[?]|%3f/i);
    } finally {
      log.restore();
    }
  });
});
