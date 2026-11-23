// End-to-end over HTTP: reading and importing tax rates, and the import gate.
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

let billing: request.Agent;

let sales: request.Agent;

async function loginAgent(username: string, password: string): Promise<request.Agent> {
  const agent = request.agent(app.getHttpServer());
  const response = await agent.post('/auth/login').send({ username, password });
  expect(response.status).toBe(200);
  return agent;
}

function http(): request.Agent {
  return request(app.getHttpServer());
}

const DOR_RELEASE = [
  'Name,Code,State,Local,RTA,Rate,Effective Date,Expiration Date',
  'SAMPLE CITY,9021,0.065,0.027,0,0.092,20260701,20260930',
  'SAMPLE COUNTY,9047,0.065,0.009,0,0.074,20260701,20260930',
].join('\n');

interface ImportBody {
  text: string;
  format: string;
  dryRun?: boolean;
}

async function load(agent: request.Agent, body: ImportBody): Promise<request.Response> {
  return agent.post('/quoting/tax-rates/import').send(body);
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
});

afterAll(async () => {
  await app.close();
});

describe('Tax rates edge — who may do what', () => {
  it('refuses an anonymous read and an anonymous load', async () => {
    expect((await http().get('/quoting/tax-rates')).status).toBe(401);
    expect(
      (await http().post('/quoting/tax-rates/import').send({ text: '', format: 'erp_rows' }))
        .status,
    ).toBe(401);
  });

  it('lets any signed-in user read the rates', async () => {
    const listed = await sales.get('/quoting/tax-rates');
    expect(listed.status).toBe(200);
    expect(listed.body.items).toBeInstanceOf(Array);

    expect((await sales.get('/quoting/tax-rates/ID/history')).status).toBe(200);
  });

  it('refuses a load from a role that does not hold the write gate', async () => {
    const refused = await load(sales, { text: DOR_RELEASE, format: 'wa_dor_rates' });
    expect(refused.status).toBe(403);
  });
});

describe('Tax rates edge — reading what is loaded', () => {
  it('lists Idaho as a statute rate that is never stale', async () => {
    const listed = await billing.get('/quoting/tax-rates');
    expect(listed.status).toBe(200);

    const idaho = (listed.body.items as Record<string, unknown>[]).find(
      (row) => row.jurisdiction === 'ID',
    );
    expect(idaho).toMatchObject({ rate: '0.060000', source: 'statute', stale: false });
  });

  it('states the day and the quarter boundary it judged staleness against', async () => {
    const listed = await billing.get('/quoting/tax-rates');
    expect(listed.body.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(listed.body.currentQuarterStart).toMatch(/^\d{4}-(01|04|07|10)-01$/);
  });

  it('starts with no Washington rate until a quarter is loaded', async () => {
    const listed = await billing.get('/quoting/tax-rates');
    const washington = (listed.body.items as Record<string, unknown>[]).filter((row) =>
      String(row.jurisdiction).startsWith('WA-'),
    );
    expect(washington).toEqual([]);
  });
});

describe('Tax rates edge — loading a quarter', () => {
  it('previews a DOR release without writing anything', async () => {
    const preview = await load(billing, { text: DOR_RELEASE, format: 'wa_dor_rates' });

    expect(preview.status).toBe(200);
    expect(preview.body).toMatchObject({ dryRun: true, refused: false, inserted: 0 });
    expect(preview.body.rows).toHaveLength(2);
    expect(preview.body.rows[0]).toMatchObject({
      jurisdiction: 'WA-9021',
      name: 'SAMPLE CITY',
      rate: '0.092000',
      effectiveFrom: '2026-07-01',
      verdict: 'new',
    });

    const listed = await billing.get('/quoting/tax-rates');
    expect(
      (listed.body.items as Record<string, unknown>[]).some((row) =>
        String(row.jurisdiction).startsWith('WA-'),
      ),
    ).toBe(false);
  });

  it('applies the quarter, and the sample city is then billable at 9.2%', async () => {
    const applied = await load(billing, {
      text: DOR_RELEASE,
      format: 'wa_dor_rates',
      dryRun: false,
    });
    expect(applied.status).toBe(200);
    expect(applied.body).toMatchObject({
      dryRun: false,
      refused: false,
      inserted: 2,
      skipped: 0,
      filled: 0,
    });

    const listed = await billing.get('/quoting/tax-rates');
    const sampleCity = (listed.body.items as Record<string, unknown>[]).find(
      (row) => row.jurisdiction === 'WA-9021',
    );

    expect(sampleCity).toMatchObject({
      rate: '0.092000',
      name: 'SAMPLE CITY',
      source: 'wa_dor',
      stateRate: '0.065000',
      localRate: '0.027000',
      rtaRate: '0.000000',
    });
  });

  it('reports a re-loaded quarter as unchanged and writes nothing', async () => {
    const again = await load(billing, {
      text: DOR_RELEASE,
      format: 'wa_dor_rates',
      dryRun: false,
    });

    expect(again.body).toMatchObject({ refused: false, inserted: 0, skipped: 2, filled: 0 });
    expect((again.body.rows as Record<string, unknown>[]).map((row) => row.verdict)).toEqual([
      'unchanged',
      'unchanged',
    ]);
  });

  it('REFUSES a changed rate at a quarter already stored, naming what is on file', async () => {
    const corrected = await load(billing, {
      text: DOR_RELEASE.replace('0,0.092,20260701', '0,0.096,20260701').replace(
        'SAMPLE CITY,9021,0.065,0.027',
        'SAMPLE CITY,9021,0.065,0.031',
      ),
      format: 'wa_dor_rates',
      dryRun: false,
    });

    expect(corrected.status).toBe(200);
    expect(corrected.body).toMatchObject({ refused: true, inserted: 0 });
    expect(corrected.body.rows[0]).toMatchObject({
      verdict: 'conflict',
      rate: '0.096000',
      storedRate: '0.092000',
    });

    const listed = await billing.get('/quoting/tax-rates');
    expect(
      (listed.body.items as Record<string, unknown>[]).find(
        (row) => row.jurisdiction === 'WA-9021',
      ),
    ).toMatchObject({ rate: '0.092000' });
  });

  it('accepts a later quarter beside the one stored, and history shows both', async () => {
    const q4 = await load(billing, {
      text: 'WA-9021,0.094,2026-10-01,wa_dor,SAMPLE CITY',
      format: 'erp_rows',
      dryRun: false,
    });
    expect(q4.body).toMatchObject({ refused: false, inserted: 1 });

    const history = await billing.get('/quoting/tax-rates/WA-9021/history');
    expect(history.status).toBe(200);
    expect(
      (history.body.items as Record<string, unknown>[]).map((row) => row.effectiveFrom),
    ).toEqual(['2026-10-01', '2026-07-01']);
  });

  it('fills the parts of a row typed without them, and reads them back', async () => {
    const typed = await load(billing, {
      text: 'WA-9063,0.097,2026-07-01,wa_dor,SAMPLE TOWN',
      format: 'erp_rows',
      dryRun: false,
    });
    expect(typed.body).toMatchObject({ refused: false, inserted: 1 });

    const sampleTown = async (): Promise<Record<string, unknown> | undefined> =>
      ((await billing.get('/quoting/tax-rates')).body.items as Record<string, unknown>[]).find(
        (row) => row.jurisdiction === 'WA-9063',
      );
    expect(await sampleTown()).not.toHaveProperty('stateRate');

    const filled = await load(billing, {
      text: [
        'Name,Code,State,Local,RTA,Rate,Effective Date,Expiration Date',
        'SAMPLE TOWN,9063,0.065,0.032,0,0.097,20260701,20260930',
      ].join('\n'),
      format: 'wa_dor_rates',
      dryRun: false,
    });
    expect(filled.body).toMatchObject({ refused: false, inserted: 0, skipped: 1, filled: 1 });
    expect(filled.body.rows[0]).toMatchObject({ verdict: 'unchanged', fillsParts: true });

    expect(await sampleTown()).toMatchObject({
      rate: '0.097000',
      name: 'SAMPLE TOWN',
      source: 'wa_dor',
      stateRate: '0.065000',
      localRate: '0.032000',
      rtaRate: '0.000000',
    });
  });

  it('refuses an unreadable line and names it, writing nothing', async () => {
    const broken = await load(billing, {
      text: ['WA-9058,0.068,2026-07-01,wa_dor', 'WA-9076,not-a-rate,2026-07-01,wa_dor'].join('\n'),
      format: 'erp_rows',
      dryRun: false,
    });

    expect(broken.body).toMatchObject({ refused: true, inserted: 0 });
    expect(broken.body.issues[0]).toMatchObject({ line: 2 });

    const listed = await billing.get('/quoting/tax-rates');
    expect(
      (listed.body.items as Record<string, unknown>[]).some(
        (row) => row.jurisdiction === 'WA-9058',
      ),
    ).toBe(false);
  });

  it('rejects a request that is malformed rather than merely refused', async () => {
    expect((await load(billing, { text: 'x', format: 'not-a-format' })).status).toBe(400);
    expect(
      (await billing.post('/quoting/tax-rates/import').send({ format: 'erp_rows' })).status,
    ).toBe(400);
  });
});
