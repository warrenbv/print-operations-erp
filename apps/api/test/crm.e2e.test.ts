// End-to-end over HTTP: customers, the credit hold, the role gates, validation and error mapping.
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

function http(): request.Agent {
  return request(app.getHttpServer());
}

async function loginAgent(username: string, password: string): Promise<request.Agent> {
  const agent = request.agent(app.getHttpServer());
  const response = await agent.post('/auth/login').send({ username, password });
  expect(response.status).toBe(200);
  return agent;
}

describe('CRM edge — authentication', () => {
  it('rejects an anonymous request to any CRM route (SessionGuard)', async () => {
    expect((await http().get('/crm/customers')).status).toBe(401);
    expect((await http().post('/crm/customers').send({ name: 'Acme' })).status).toBe(401);
  });
});

describe('CRM edge — authorization (fail-closed, then by role)', () => {
  it('denies POST /crm/customers to a signed-in user without Sales or Admin', async () => {
    const agent = await loginAgent('dev-sales', DEV_PASSWORD);
    const response = await agent.post('/crm/customers').send({ name: 'Denied Corp' });
    expect(response.status).toBe(403);
  });

  it('allows POST /crm/customers to break-glass (implicit Admin)', async () => {
    const agent = await loginAgent('break-glass', BREAK_GLASS_PASSWORD);
    const response = await agent
      .post('/crm/customers')
      .send({ name: 'Authorized Corp', legacyAccountNumber: 'LA-BG-1' });
    expect(response.status).toBe(201);
    expect(response.body.name).toBe('Authorized Corp');
    expect(typeof response.body.id).toBe('string');
    expect(typeof response.body.createdAt).toBe('string');
  });

  it('allows GET /crm/customers to any signed-in user (Authenticated only)', async () => {
    const agent = await loginAgent('dev-billing', DEV_PASSWORD);
    const response = await agent.get('/crm/customers');
    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('items');
    expect(response.body).toHaveProperty('total');
  });
});

describe('CRM edge — validation and error mapping', () => {
  it('400s on a malformed create body', async () => {
    const agent = await loginAgent('break-glass', BREAK_GLASS_PASSWORD);
    const response = await agent.post('/crm/customers').send({ name: '' });
    expect(response.status).toBe(400);
  });

  it('409s on a duplicate legacyAccountNumber', async () => {
    const agent = await loginAgent('break-glass', BREAK_GLASS_PASSWORD);
    await agent.post('/crm/customers').send({ name: 'First Owner', legacyAccountNumber: 'LA-DUP' });
    const dup = await agent
      .post('/crm/customers')
      .send({ name: 'Second Owner', legacyAccountNumber: 'LA-DUP' });
    expect(dup.status).toBe(409);
    expect(dup.body.reason).toBe('duplicate-legacy-account-number');
  });

  it('404s a PATCH against an unknown id', async () => {
    const agent = await loginAgent('break-glass', BREAK_GLASS_PASSWORD);

    const response = await agent
      .patch('/crm/customers/00000000-0000-4000-8000-000000000000')
      .send({ name: 'New Name', lockVersion: 1 });
    expect(response.status).toBe(404);
  });
});

describe('CRM edge — the round trip', () => {
  it('creates, updates, fetches, and searches a customer end-to-end', async () => {
    const agent = await loginAgent('break-glass', BREAK_GLASS_PASSWORD);

    const created = await agent
      .post('/crm/customers')
      .send({ name: 'Roundtrip Inc', legacyAccountNumber: 'LA-RT-1' });
    expect(created.status).toBe(201);
    const { id } = created.body;

    const patched = await agent
      .patch(`/crm/customers/${id}`)
      .send({ lockVersion: 1, name: 'Roundtrip LLC' });
    expect(patched.status).toBe(200);
    expect(patched.body.name).toBe('Roundtrip LLC');

    const fetched = await agent.get(`/crm/customers/${id}`);
    expect(fetched.status).toBe(200);
    expect(fetched.body.name).toBe('Roundtrip LLC');

    const searched = await agent.get('/crm/customers').query({ q: 'roundtrip' });
    expect(searched.status).toBe(200);
    expect(searched.body.items.map((c: { name: string }) => c.name)).toContain('Roundtrip LLC');
  });
});

describe('CRM edge — the suggestion list and the wider search', () => {
  it('answers the names list as three fields, and does not read "names" as an id', async () => {
    const agent = await loginAgent('break-glass', BREAK_GLASS_PASSWORD);
    const created = await agent
      .post('/crm/customers')
      .send({ name: 'Suggestion Co', legacyAccountNumber: 'LA-SUGGEST-1' });
    expect(created.status).toBe(201);

    const names = await agent.get('/crm/customers/names');
    expect(names.status).toBe(200);
    expect(typeof names.body.total).toBe('number');
    const mine = (names.body.items as { id: string; name: string }[]).find(
      (c) => c.name === 'Suggestion Co',
    );
    expect(mine).toEqual({
      id: created.body.id,
      name: 'Suggestion Co',
      legacyAccountNumber: 'LA-SUGGEST-1',
    });
  });

  it('is readable by any signed-in user, like the search beside it', async () => {
    const agent = await loginAgent('dev-production', DEV_PASSWORD);
    expect((await agent.get('/crm/customers/names')).status).toBe(200);
  });

  it('refuses the names list to an anonymous caller', async () => {
    expect((await http().get('/crm/customers/names')).status).toBe(401);
  });

  it('finds an account by its legacy account number and by its umbrella number', async () => {
    const agent = await loginAgent('break-glass', BREAK_GLASS_PASSWORD);
    const created = await agent.post('/crm/customers').send({
      name: 'Wider Match Co',
      legacyAccountNumber: 'LA-WIDER-7',
      legacyUmbrellaAccountNumber: 'UMB-WIDER',
    });
    expect(created.status).toBe(201);

    for (const q of ['LA-WIDER-7', 'wider-7', 'UMB-WIDER', 'umb-wider']) {
      const found = await agent.get('/crm/customers').query({ q });
      expect(found.status, q).toBe(200);
      expect(
        (found.body.items as { name: string }[]).map((c) => c.name),
        q,
      ).toContain('Wider Match Co');
    }
  });
});

describe('CRM edge — the account-rep filter', () => {
  it('returns one rep’s accounts, with a total that narrows too', async () => {
    const agent = await loginAgent('break-glass', BREAK_GLASS_PASSWORD);
    const janes = await agent
      .post('/crm/customers')
      .send({ name: 'Rep Filter Jane Co', accountRepUsername: 'jsmith' });
    expect(janes.status).toBe(201);
    const rowans = await agent
      .post('/crm/customers')
      .send({ name: 'Rep Filter Rowan Co', accountRepUsername: 'rlee' });
    expect(rowans.status).toBe(201);
    const nobodys = await agent.post('/crm/customers').send({ name: 'Rep Filter Nobody Co' });
    expect(nobodys.status).toBe(201);

    const filtered = await agent.get('/crm/customers').query({ accountRepUsername: 'jsmith' });
    expect(filtered.status).toBe(200);
    const names = (filtered.body.items as { name: string }[]).map((c) => c.name);
    expect(names).toContain('Rep Filter Jane Co');
    expect(names).not.toContain('Rep Filter Rowan Co');
    expect(names).not.toContain('Rep Filter Nobody Co');

    expect(filtered.body.total).toBe(names.length);

    const both = await agent
      .get('/crm/customers')
      .query({ accountRepUsername: 'jsmith', q: 'rowan' });
    expect(both.body.items).toEqual([]);
    expect(both.body.total).toBe(0);
  });

  it('matches the rep exactly, where the name matches loosely', async () => {
    const agent = await loginAgent('break-glass', BREAK_GLASS_PASSWORD);
    expect(
      (await agent.get('/crm/customers').query({ accountRepUsername: 'jsmit' })).body.total,
    ).toBe(0);
  });

  it('400s an empty rep, and refuses it beside an id lookup', async () => {
    const agent = await loginAgent('break-glass', BREAK_GLASS_PASSWORD);

    expect((await agent.get('/crm/customers?accountRepUsername=')).status).toBe(400);
    expect((await agent.get('/crm/customers?accountRepUsername=%20')).status).toBe(400);

    expect(
      (
        await agent.get(
          '/crm/customers?ids=00000000-0000-4000-8000-000000000000&accountRepUsername=jsmith',
        )
      ).status,
    ).toBe(400);
  });
});

describe('CRM edge — the credit-hold filter', () => {
  async function heldAndClear(agent: request.Agent): Promise<void> {
    const held = await agent
      .post('/crm/customers')
      .send({ name: 'Hold Filter Jane Held Co', accountRepUsername: 'jsmith' });
    expect(held.status).toBe(201);
    const hold = await agent
      .put(`/crm/customers/${held.body.id as string}/credit-hold`)
      .send({ lockVersion: held.body.lockVersion as number, held: true });
    expect(hold.status).toBe(200);
    const clear = await agent
      .post('/crm/customers')
      .send({ name: 'Hold Filter Jane Clear Co', accountRepUsername: 'jsmith' });
    expect(clear.status).toBe(201);
    const rowans = await agent
      .post('/crm/customers')
      .send({ name: 'Hold Filter Rowan Held Co', accountRepUsername: 'rlee' });
    expect(rowans.status).toBe(201);
    const rowanHold = await agent
      .put(`/crm/customers/${rowans.body.id as string}/credit-hold`)
      .send({ lockVersion: rowans.body.lockVersion as number, held: true });
    expect(rowanHold.status).toBe(200);
  }

  beforeAll(async () => {
    await heldAndClear(await loginAgent('break-glass', BREAK_GLASS_PASSWORD));
  });

  function namesOf(body: { items: { name: string }[] }): string[] {
    return body.items.map((c) => c.name);
  }

  it('returns the held accounts under true and the clear ones under false', async () => {
    const agent = await loginAgent('break-glass', BREAK_GLASS_PASSWORD);

    const held = await agent.get('/crm/customers').query({ q: 'Hold Filter', creditHold: 'true' });
    expect(held.status).toBe(200);
    expect(namesOf(held.body)).toEqual(['Hold Filter Jane Held Co', 'Hold Filter Rowan Held Co']);
    expect(held.body.total).toBe(2);

    const clear = await agent
      .get('/crm/customers')
      .query({ q: 'Hold Filter', creditHold: 'false' });
    expect(clear.status).toBe(200);
    expect(namesOf(clear.body)).toEqual(['Hold Filter Jane Clear Co']);
    expect(clear.body.total).toBe(1);

    const both = await agent.get('/crm/customers').query({ q: 'Hold Filter' });
    expect(both.body.total).toBe(3);
  });

  it('combines the hold with the rep and paging, and the total counts the filtered rows', async () => {
    const agent = await loginAgent('break-glass', BREAK_GLASS_PASSWORD);
    const janes = await agent
      .get('/crm/customers')
      .query({ q: 'Hold Filter', creditHold: 'true', accountRepUsername: 'jsmith' });
    expect(namesOf(janes.body)).toEqual(['Hold Filter Jane Held Co']);
    expect(janes.body.total).toBe(1);

    const paged = await agent
      .get('/crm/customers')
      .query({ q: 'Hold Filter', creditHold: 'true', limit: 1, offset: 1 });
    expect(namesOf(paged.body)).toEqual(['Hold Filter Rowan Held Co']);
    expect(paged.body.total).toBe(2);
  });

  it('400s any other value, and refuses the filter beside an id lookup', async () => {
    const agent = await loginAgent('break-glass', BREAK_GLASS_PASSWORD);
    for (const value of ['yes', '1', 'TRUE', '']) {
      expect((await agent.get(`/crm/customers?creditHold=${value}`)).status).toBe(400);
    }

    for (const value of ['true', 'false']) {
      expect(
        (
          await agent.get(
            `/crm/customers?ids=00000000-0000-4000-8000-000000000000&creditHold=${value}`,
          )
        ).status,
      ).toBe(400);
    }
  });
});

describe('CRM edge — bulk lookup by id', () => {
  it('resolves several ids in one request, unpaged', async () => {
    const agent = await loginAgent('break-glass', BREAK_GLASS_PASSWORD);
    const a = await agent.post('/crm/customers').send({ name: 'Bulk Alpha' });
    const b = await agent.post('/crm/customers').send({ name: 'Bulk Beta' });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);

    const looked = await agent
      .get('/crm/customers')
      .query({ ids: `${a.body.id},${b.body.id}`, limit: 1 });

    expect(looked.status).toBe(200);
    expect(looked.body.total).toBe(2);
    expect((looked.body.items as { name: string }[]).map((c) => c.name)).toEqual([
      'Bulk Alpha',
      'Bulk Beta',
    ]);
  });

  it('omits an id that does not resolve rather than failing the batch', async () => {
    const agent = await loginAgent('break-glass', BREAK_GLASS_PASSWORD);
    const created = await agent.post('/crm/customers').send({ name: 'Bulk Survivor' });
    expect(created.status).toBe(201);

    const looked = await agent
      .get('/crm/customers')
      .query({ ids: `${created.body.id},01988a00-9999-7000-8000-00000000dead` });

    expect(looked.status).toBe(200);
    expect(looked.body.total).toBe(1);
    expect((looked.body.items as { name: string }[]).map((c) => c.name)).toEqual(['Bulk Survivor']);
  });

  it('400s a bare ids=, an over-long list, and ids combined with q', async () => {
    const agent = await loginAgent('break-glass', BREAK_GLASS_PASSWORD);

    expect((await agent.get('/crm/customers').query({ ids: '' })).status).toBe(400);

    const tooMany = Array.from({ length: 101 }, (_, i) => `id-${i}`).join(',');
    expect((await agent.get('/crm/customers').query({ ids: tooMany })).status).toBe(400);

    expect((await agent.get('/crm/customers').query({ ids: 'a,b', q: 'bulk' })).status).toBe(400);
  });
});

describe('PUT /crm/customers/:id/credit-hold', () => {
  async function grantRoles(): Promise<void> {
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
  }

  async function aCustomer(agent: request.Agent): Promise<string> {
    const created = await agent.post('/crm/customers').send({ name: 'Held Co' });
    expect(created.status).toBe(201);
    return created.body.id as string;
  }

  it('lets the Billing Manager hold an account, recording who and when', async () => {
    await grantRoles();
    const admin = await loginAgent('break-glass', BREAK_GLASS_PASSWORD);
    const billing = await loginAgent('dev-billing', DEV_PASSWORD);
    const id = await aCustomer(admin);

    const response = await billing
      .put(`/crm/customers/${id}/credit-hold`)
      .send({ lockVersion: 1, held: true });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ creditHold: true, creditHoldSetBy: 'dev-billing' });

    expect(typeof response.body.creditHoldSetAt).toBe('string');
  });

  it('refuses Sales, who may edit every other field on the customer', async () => {
    await grantRoles();
    const admin = await loginAgent('break-glass', BREAK_GLASS_PASSWORD);
    const sales = await loginAgent('dev-sales', DEV_PASSWORD);
    const id = await aCustomer(admin);

    expect(
      (await sales.patch(`/crm/customers/${id}`).send({ lockVersion: 1, name: 'Renamed' })).status,
    ).toBe(200);
    expect(
      (await sales.put(`/crm/customers/${id}/credit-hold`).send({ lockVersion: 1, held: true }))
        .status,
    ).toBe(403);
  });

  it('shows the hold wherever the customer is read, not only on a failed quote', async () => {
    const admin = await loginAgent('break-glass', BREAK_GLASS_PASSWORD);
    const id = await aCustomer(admin);
    await admin.put(`/crm/customers/${id}/credit-hold`).send({ lockVersion: 1, held: true });

    expect((await admin.get(`/crm/customers/${id}`)).body.creditHold).toBe(true);
    const listed = (await admin.get('/crm/customers').query({ ids: id })).body;
    expect(listed.items[0]).toMatchObject({ creditHold: true });
  });

  it('clears a hold, and keeps who cleared it', async () => {
    const admin = await loginAgent('break-glass', BREAK_GLASS_PASSWORD);
    const id = await aCustomer(admin);
    const held = await admin
      .put(`/crm/customers/${id}/credit-hold`)
      .send({ lockVersion: 1, held: true });

    const cleared = await admin
      .put(`/crm/customers/${id}/credit-hold`)
      .send({ lockVersion: held.body.lockVersion, held: false });

    expect(cleared.body).toMatchObject({ creditHold: false, creditHoldSetBy: 'break-glass' });
  });

  it('404s an unknown customer and 400s a malformed body', async () => {
    const admin = await loginAgent('break-glass', BREAK_GLASS_PASSWORD);
    const id = await aCustomer(admin);

    expect(
      (
        await admin
          .put('/crm/customers/01988a00-0002-7000-8000-00000000dead/credit-hold')
          .send({ held: true, lockVersion: 1 })
      ).status,
    ).toBe(404);
    expect(
      (await admin.put(`/crm/customers/${id}/credit-hold`).send({ lockVersion: 1 })).status,
    ).toBe(400);
  });
});

describe('CRM edge — the billing address', () => {
  const ADDRESS = {
    name: 'Accounts Payable',
    line1: '310 Demo Avenue',
    line2: 'Attn: Alex Demo',
    city: 'Demo Landing',
    state: 'WA',
    postalCode: '99000',
  };

  it('creates a customer with a billing address and reads it back', async () => {
    const agent = await loginAgent('break-glass', BREAK_GLASS_PASSWORD);

    const created = await agent
      .post('/crm/customers')
      .send({ name: 'Billing Alpha', billingAddress: ADDRESS });
    expect(created.status).toBe(201);
    expect(created.body.billingAddress).toEqual(ADDRESS);

    const fetched = await agent.get(`/crm/customers/${created.body.id}`);
    expect(fetched.body.billingAddress).toEqual(ADDRESS);
  });

  it('creates a customer without one — it is optional', async () => {
    const agent = await loginAgent('break-glass', BREAK_GLASS_PASSWORD);
    const created = await agent.post('/crm/customers').send({ name: 'Billing Beta' });
    expect(created.status).toBe(201);
    expect(created.body.billingAddress).toBeUndefined();
  });

  it('adds an address by PATCH to a customer that had none', async () => {
    const agent = await loginAgent('break-glass', BREAK_GLASS_PASSWORD);
    const created = await agent.post('/crm/customers').send({ name: 'Billing Gamma' });

    const patched = await agent
      .patch(`/crm/customers/${created.body.id}`)
      .send({ lockVersion: 1, billingAddress: ADDRESS });
    expect(patched.status).toBe(200);
    expect(patched.body.billingAddress).toEqual(ADDRESS);
  });

  it('replaces the address wholesale, dropping the parts the new one omits', async () => {
    const agent = await loginAgent('break-glass', BREAK_GLASS_PASSWORD);
    const created = await agent
      .post('/crm/customers')
      .send({ name: 'Billing Delta', billingAddress: ADDRESS });

    const replacement = {
      line1: '4471 Mill Road',
      city: 'Demo Falls',
      state: 'ID',
      postalCode: '83010',
    };
    const patched = await agent
      .patch(`/crm/customers/${created.body.id}`)
      .send({ lockVersion: 1, billingAddress: replacement });
    expect(patched.body.billingAddress).toEqual(replacement);
  });

  it('400s a partial address rather than storing half of one', async () => {
    const agent = await loginAgent('break-glass', BREAK_GLASS_PASSWORD);
    const response = await agent
      .post('/crm/customers')

      .send({
        name: 'Billing Epsilon',
        billingAddress: { line1: '4471 Mill Road', city: 'Demo Falls' },
      });
    expect(response.status).toBe(400);
  });

  it('400s a single-field billing patch — a merge would leave the old street', async () => {
    const agent = await loginAgent('break-glass', BREAK_GLASS_PASSWORD);
    const created = await agent
      .post('/crm/customers')
      .send({ name: 'Billing Zeta', billingAddress: ADDRESS });

    const response = await agent
      .patch(`/crm/customers/${created.body.id}`)
      .send({ lockVersion: 1, billingAddress: { city: 'Sample Harbor' } });
    expect(response.status).toBe(400);
  });

  it('denies writing an address to a user without Sales or Admin', async () => {
    const agent = await loginAgent('dev-production', DEV_PASSWORD);
    const response = await agent
      .post('/crm/customers')
      .send({ name: 'Billing Eta', billingAddress: ADDRESS });
    expect(response.status).toBe(403);
  });
});

describe('CRM edge - shipping address', () => {
  const BILL_TO = {
    name: 'Accounts Payable',
    line1: '310 Demo Avenue',
    city: 'Demo Landing',
    state: 'WA',
    postalCode: '99000',
  };

  const SHIP_TO = {
    name: 'Receiving',
    line1: '400 Warehouse Way',
    line2: 'Dock 3',
    city: 'Sample Harbor',
    state: 'WA',
    postalCode: '98000-6153',
  };

  it('creates a customer with both addresses and reads them back', async () => {
    const agent = await loginAgent('break-glass', BREAK_GLASS_PASSWORD);

    const created = await agent
      .post('/crm/customers')
      .send({ name: 'Ship To Alpha', billingAddress: BILL_TO, shippingAddress: SHIP_TO });
    expect(created.status).toBe(201);
    expect(created.body.shippingAddress).toEqual(SHIP_TO);

    const fetched = await agent.get(`/crm/customers/${created.body.id}`);
    expect(fetched.body.billingAddress).toEqual(BILL_TO);
    expect(fetched.body.shippingAddress).toEqual(SHIP_TO);
  });

  it('creates a customer without one - it is optional, and seeds nothing', async () => {
    const agent = await loginAgent('break-glass', BREAK_GLASS_PASSWORD);
    const created = await agent.post('/crm/customers').send({ name: 'Ship To Beta' });
    expect(created.status).toBe(201);
    expect(created.body.shippingAddress).toBeUndefined();
  });

  it('adds one by PATCH, then clears it with null', async () => {
    const agent = await loginAgent('break-glass', BREAK_GLASS_PASSWORD);
    const created = await agent
      .post('/crm/customers')
      .send({ name: 'Ship To Gamma', billingAddress: BILL_TO });

    const patched = await agent
      .patch(`/crm/customers/${created.body.id}`)
      .send({ lockVersion: 1, shippingAddress: SHIP_TO });
    expect(patched.status).toBe(200);
    expect(patched.body.shippingAddress).toEqual(SHIP_TO);

    const cleared = await agent
      .patch(`/crm/customers/${created.body.id}`)
      .send({ lockVersion: patched.body.lockVersion, shippingAddress: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.shippingAddress).toBeUndefined();

    expect(cleared.body.billingAddress).toEqual(BILL_TO);
  });

  it('400s a partial shipping address rather than storing half of one', async () => {
    const agent = await loginAgent('break-glass', BREAK_GLASS_PASSWORD);
    const response = await agent.post('/crm/customers').send({
      name: 'Ship To Delta',
      shippingAddress: { line1: '400 Warehouse Way', city: 'Sample Harbor' },
    });
    expect(response.status).toBe(400);
  });
});

describe('CRM edge - the default tax jurisdiction is a key', () => {
  const RULE =
    'tax jurisdiction must be ID, or WA- and the four-digit DOR location code, ' +
    'such as WA-0202 for Clarkston.';

  it('400s a bare state on create, with the sentence that gives the format', async () => {
    const agent = await loginAgent('break-glass', BREAK_GLASS_PASSWORD);
    const response = await agent
      .post('/crm/customers')
      .send({ name: 'Bare State Co', taxJurisdiction: 'WA' });

    expect(response.status).toBe(400);
    expect(response.body.fieldErrors.taxJurisdiction).toEqual([RULE]);
  });

  it('400s a bare state on update, and leaves the stored key alone', async () => {
    const agent = await loginAgent('break-glass', BREAK_GLASS_PASSWORD);
    const created = await agent
      .post('/crm/customers')
      .send({ name: 'Keyed Co', taxJurisdiction: 'WA-0202' });
    expect(created.status).toBe(201);

    const response = await agent
      .patch(`/crm/customers/${created.body.id}`)
      .send({ lockVersion: 1, taxJurisdiction: 'WA' });
    expect(response.status).toBe(400);
    expect(response.body.fieldErrors.taxJurisdiction).toEqual([RULE]);

    const fetched = await agent.get(`/crm/customers/${created.body.id}`);
    expect(fetched.body.taxJurisdiction).toBe('WA-0202');
  });
});

describe('CRM edge - null clears an optional field', () => {
  const ADDRESS = {
    name: 'Accounts Payable',
    line1: '310 Demo Avenue',
    city: 'Demo Landing',
    state: 'WA',
    postalCode: '99000',
  };

  it('sets, then clears, then reads back through the real edge', async () => {
    const agent = await loginAgent('break-glass', BREAK_GLASS_PASSWORD);

    const created = await agent.post('/crm/customers').send({
      name: 'Clearable Co',
      legacyAccountNumber: 'LA-CLR-1',
      taxJurisdiction: 'WA-0202',
      taxExemptionDocRef: 'exempt-2026.pdf',
      freightMarginPct: '0.120000',
      billingAddress: ADDRESS,
    });
    expect(created.status).toBe(201);
    const { id } = created.body;

    const cleared = await agent.patch(`/crm/customers/${id}`).send({
      lockVersion: 1,
      legacyAccountNumber: null,
      taxJurisdiction: null,
      taxExemptionDocRef: null,
      freightMarginPct: null,
      billingAddress: null,
    });
    expect(cleared.status).toBe(200);

    const fetched = await agent.get(`/crm/customers/${id}`);
    expect(fetched.body.legacyAccountNumber).toBeUndefined();
    expect(fetched.body.taxJurisdiction).toBeUndefined();
    expect(fetched.body.taxExemptionDocRef).toBeUndefined();
    expect(fetched.body.freightMarginPct).toBeUndefined();
    expect(fetched.body.billingAddress).toBeUndefined();

    expect(fetched.body.name).toBe('Clearable Co');
    expect(fetched.body.paymentTerms).toEqual({ netDays: 15 });
  });

  it('leaves a field alone when the patch omits it', async () => {
    const agent = await loginAgent('break-glass', BREAK_GLASS_PASSWORD);
    const created = await agent
      .post('/crm/customers')
      .send({ name: 'Omit Co', taxJurisdiction: 'ID' });

    await agent
      .patch(`/crm/customers/${created.body.id}`)
      .send({ lockVersion: 1, name: 'Omit Co Renamed' });

    const fetched = await agent.get(`/crm/customers/${created.body.id}`);
    expect(fetched.body.name).toBe('Omit Co Renamed');
    expect(fetched.body.taxJurisdiction).toBe('ID');
  });

  it('400s a null payment terms - an account always has terms', async () => {
    const agent = await loginAgent('break-glass', BREAK_GLASS_PASSWORD);
    const created = await agent.post('/crm/customers').send({ name: 'Terms Co' });

    const response = await agent
      .patch(`/crm/customers/${created.body.id}`)
      .send({ lockVersion: 1, paymentTerms: null });
    expect(response.status).toBe(400);
  });

  it('frees a cleared legacy account number for another customer', async () => {
    const agent = await loginAgent('break-glass', BREAK_GLASS_PASSWORD);
    const first = await agent
      .post('/crm/customers')
      .send({ name: 'Typo Co', legacyAccountNumber: 'LA-TYPO-1' });

    await agent
      .patch(`/crm/customers/${first.body.id}`)
      .send({ lockVersion: 1, legacyAccountNumber: null });

    const second = await agent
      .post('/crm/customers')
      .send({ name: 'Correct Co', legacyAccountNumber: 'LA-TYPO-1' });
    expect(second.status).toBe(201);
  });
});

describe('CRM edge - lockVersion refuses a stale write', () => {
  it('409s a second PATCH at the generation the first one consumed', async () => {
    const agent = await loginAgent('break-glass', BREAK_GLASS_PASSWORD);
    const created = await agent.post('/crm/customers').send({ name: 'Contended Co' });
    const { id, lockVersion } = created.body;
    expect(lockVersion).toBe(1);

    const first = await agent.patch(`/crm/customers/${id}`).send({ name: 'First In', lockVersion });
    expect(first.status).toBe(200);
    expect(first.body.lockVersion).toBe(2);

    const second = await agent
      .patch(`/crm/customers/${id}`)
      .send({ name: 'Second In', lockVersion });
    expect(second.status).toBe(409);
    expect(second.body.reason).toBe('stale-aggregate');

    expect(second.body.value).toEqual({ expected: 1, actual: 2 });

    const fetched = await agent.get(`/crm/customers/${id}`);
    expect(fetched.body.name).toBe('First In');
  });

  it('400s a PATCH that omits the token rather than falling back to last-write-wins', async () => {
    const agent = await loginAgent('break-glass', BREAK_GLASS_PASSWORD);
    const created = await agent.post('/crm/customers').send({ name: 'Tokenless Co' });

    const response = await agent
      .patch(`/crm/customers/${created.body.id}`)
      .send({ name: 'No Token' });
    expect(response.status).toBe(400);
  });

  it('409s a credit hold placed against a stale generation', async () => {
    const admin = await loginAgent('break-glass', BREAK_GLASS_PASSWORD);
    const created = await admin.post('/crm/customers').send({ name: 'Hold Race Co' });
    const { id } = created.body;

    await admin.patch(`/crm/customers/${id}`).send({ name: 'Renamed First', lockVersion: 1 });

    const stale = await admin
      .put(`/crm/customers/${id}/credit-hold`)
      .send({ held: true, lockVersion: 1 });
    expect(stale.status).toBe(409);
    expect(stale.body.reason).toBe('stale-aggregate');

    const fetched = await admin.get(`/crm/customers/${id}`);
    expect(fetched.body.creditHold).toBe(false);
  });

  it('moves the token on a credit hold, so an edit form opened before it is refused', async () => {
    const admin = await loginAgent('break-glass', BREAK_GLASS_PASSWORD);
    const created = await admin.post('/crm/customers').send({ name: 'Held Co' });
    const { id, lockVersion } = created.body;

    const held = await admin
      .put(`/crm/customers/${id}/credit-hold`)
      .send({ held: true, lockVersion });
    expect(held.status).toBe(200);
    expect(held.body.lockVersion).toBe(2);

    const staleEdit = await admin
      .patch(`/crm/customers/${id}`)
      .send({ name: 'Edited From A Stale Form', lockVersion });
    expect(staleEdit.status).toBe(409);
  });
});

describe('CRM edge - a malformed id names no resource', () => {
  it('answers 404 rather than 500, and the same as an unknown id', async () => {
    const agent = await loginAgent('break-glass', BREAK_GLASS_PASSWORD);

    const unknown = await agent.get('/crm/customers/01a05082-0000-7000-8000-000000000000');
    expect(unknown.status).toBe(404);

    for (const malformed of ['not-a-uuid', '486', 'null', '%20']) {
      const response = await agent.get(`/crm/customers/${malformed}`);
      expect(response.status, `GET /crm/customers/${malformed}`).toBe(404);
    }

    const contact = await agent.get('/crm/customers/not-a-uuid/contacts');
    expect(contact.status).toBe(404);
  });

  it('still refuses an anonymous caller first, because guards run before pipes', async () => {
    expect((await http().get('/crm/customers/not-a-uuid')).status).toBe(401);
  });
});

describe('CRM edge — resolving sales-rep names', () => {
  it('resolves a comma-separated list of usernames', async () => {
    const agent = await loginAgent('dev-sales', DEV_PASSWORD);

    const response = await agent.get('/sales-reps/resolve?usernames=dev-sales,nobody-here');

    expect(response.status).toBe(200);
    expect(response.body.items).toEqual(
      expect.arrayContaining([expect.objectContaining({ username: 'dev-sales' })]),
    );
  });

  it('refuses a repeated or bracketed usernames parameter with a reason, not a 500', async () => {
    const agent = await loginAgent('dev-sales', DEV_PASSWORD);

    for (const query of ['usernames=dev-sales&usernames=dev-billing', 'usernames[]=dev-sales']) {
      const response = await agent.get(`/sales-reps/resolve?${query}`);

      expect(response.status, query).toBe(400);
      expect(response.body.reason, query).toBe('invalid-usernames');
    }
  });
});
