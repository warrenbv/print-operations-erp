// End-to-end over HTTP: customer contacts, their role gate, validation, 404 mapping and the round trip.
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
  const { CrmModule } = await import('../src/crm/crm.module');
  const moduleRef = await Test.createTestingModule({
    imports: [AuthModule, CrmModule],
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

describe('CRM contacts — authorization', () => {
  it('denies POST to a signed-in user without Sales or Admin', async () => {
    const admin = await loginAgent('break-glass', BREAK_GLASS_PASSWORD);
    const customerId = await seedCustomer(admin, 'Denied Path Corp');

    const dev = await loginAgent('dev-sales', DEV_PASSWORD);
    const response = await dev.post(`/crm/customers/${customerId}/contacts`).send({ name: 'Jane' });
    expect(response.status).toBe(403);
  });

  it('allows GET to any signed-in user (Authenticated only)', async () => {
    const admin = await loginAgent('break-glass', BREAK_GLASS_PASSWORD);
    const customerId = await seedCustomer(admin, 'Readable Corp');

    const reader = await loginAgent('dev-billing', DEV_PASSWORD);
    const response = await reader.get(`/crm/customers/${customerId}/contacts`);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ items: [] });
  });
});

describe('CRM contacts — validation and 404 mapping', () => {
  it('400s on a malformed create body', async () => {
    const admin = await loginAgent('break-glass', BREAK_GLASS_PASSWORD);
    const customerId = await seedCustomer(admin, 'Validation Corp');
    const response = await admin
      .post(`/crm/customers/${customerId}/contacts`)
      .send({ name: '', email: 'not-an-email' });
    expect(response.status).toBe(400);
  });

  it('404s a POST under an unknown customer', async () => {
    const admin = await loginAgent('break-glass', BREAK_GLASS_PASSWORD);
    const response = await admin
      .post('/crm/customers/00000000-0000-4000-8000-000000000000/contacts')
      .send({ name: 'Jane' });
    expect(response.status).toBe(404);
  });

  it('404s a PATCH when the contact belongs to a different customer', async () => {
    const admin = await loginAgent('break-glass', BREAK_GLASS_PASSWORD);
    const customerA = await seedCustomer(admin, 'Corp A');
    const customerB = await seedCustomer(admin, 'Corp B');

    const created = await admin.post(`/crm/customers/${customerA}/contacts`).send({ name: 'Jane' });
    expect(created.status).toBe(201);

    const wrong = await admin
      .patch(`/crm/customers/${customerB}/contacts/${created.body.id}`)
      .send({ name: 'Hijacked', lockVersion: 1 });
    expect(wrong.status).toBe(404);
  });
});

describe('CRM contacts — the round trip', () => {
  it('creates, lists, patches, and deletes a contact', async () => {
    const admin = await loginAgent('break-glass', BREAK_GLASS_PASSWORD);
    const customerId = await seedCustomer(admin, 'Round Trip Corp');

    const created = await admin
      .post(`/crm/customers/${customerId}/contacts`)
      .send({ name: 'Alex Demo', email: 'jane@example.com' });
    expect(created.status).toBe(201);
    expect(created.body.customerId).toBe(customerId);
    const contactId = created.body.id as string;

    const list = await admin.get(`/crm/customers/${customerId}/contacts`);
    expect(list.status).toBe(200);
    expect(list.body.items.map((c: { name: string }) => c.name)).toEqual(['Alex Demo']);

    const patched = await admin
      .patch(`/crm/customers/${customerId}/contacts/${contactId}`)
      .send({ phone: '360-555-0162', lockVersion: 1 });
    expect(patched.status).toBe(200);
    expect(patched.body.phone).toBe('360-555-0162');
    expect(patched.body.email).toBe('jane@example.com');

    const deleted = await admin
      .delete(`/crm/customers/${customerId}/contacts/${contactId}`)
      .send({ lockVersion: patched.body.lockVersion });
    expect(deleted.status).toBe(204);

    const afterDelete = await admin.get(`/crm/customers/${customerId}/contacts`);
    expect(afterDelete.body.items).toEqual([]);
  });
});

describe('CRM contacts - null clears an optional field', () => {
  it('sets, then clears, then reads back through the real edge', async () => {
    const admin = await loginAgent('break-glass', BREAK_GLASS_PASSWORD);
    const customerId = await seedCustomer(admin, 'Clearable Contacts Co');

    const created = await admin
      .post(`/crm/customers/${customerId}/contacts`)
      .send({ name: 'Alex Demo', email: 'jane@example.com', phone: '360-555-0162' });
    expect(created.status).toBe(201);
    const contactId = created.body.id as string;

    const cleared = await admin
      .patch(`/crm/customers/${customerId}/contacts/${contactId}`)
      .send({ email: null, phone: null, lockVersion: 1 });
    expect(cleared.status).toBe(200);

    const list = await admin.get(`/crm/customers/${customerId}/contacts`);
    const [contact] = list.body.items;
    expect(contact.email).toBeUndefined();
    expect(contact.phone).toBeUndefined();

    expect(contact.name).toBe('Alex Demo');
  });

  it('leaves a field alone when the patch omits it', async () => {
    const admin = await loginAgent('break-glass', BREAK_GLASS_PASSWORD);
    const customerId = await seedCustomer(admin, 'Omit Contacts Co');
    const created = await admin
      .post(`/crm/customers/${customerId}/contacts`)
      .send({ name: 'Alex Demo', email: 'jane@example.com' });

    const patched = await admin
      .patch(`/crm/customers/${customerId}/contacts/${created.body.id}`)
      .send({ name: 'Jane Renamed', lockVersion: 1 });

    expect(patched.status).toBe(200);
    expect(patched.body.name).toBe('Jane Renamed');
    expect(patched.body.email).toBe('jane@example.com');
  });

  it('400s clearing the name of a contact with no address', async () => {
    const admin = await loginAgent('break-glass', BREAK_GLASS_PASSWORD);
    const customerId = await seedCustomer(admin, 'Nameless Contacts Co');
    const created = await admin
      .post(`/crm/customers/${customerId}/contacts`)
      .send({ name: 'Alex Demo' });

    const response = await admin
      .patch(`/crm/customers/${customerId}/contacts/${created.body.id}`)
      .send({ name: null, lockVersion: 1 });
    expect(response.status).toBe(400);
    expect(response.body.reason).toBe('contact-needs-name-or-email');
  });
});

describe('CRM contacts - an email address alone', () => {
  it('creates a contact with no name, and lists it with name null', async () => {
    const admin = await loginAgent('break-glass', BREAK_GLASS_PASSWORD);
    const customerId = await seedCustomer(admin, 'Shared Mailbox Co');

    const created = await admin
      .post(`/crm/customers/${customerId}/contacts`)
      .send({ email: 'ap@example.com' });
    expect(created.status).toBe(201);
    expect(created.body.name).toBeNull();

    const list = await admin.get(`/crm/customers/${customerId}/contacts`);
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0].name).toBeNull();
    expect(list.body.items[0].email).toBe('ap@example.com');
  });

  it('400s a contact with neither a name nor an email address', async () => {
    const admin = await loginAgent('break-glass', BREAK_GLASS_PASSWORD);
    const customerId = await seedCustomer(admin, 'Neither Co');
    const response = await admin
      .post(`/crm/customers/${customerId}/contacts`)
      .send({ phone: '360-555-0162' });
    expect(response.status).toBe(400);
  });

  it('clears the name of a contact with an address, and refuses clearing that address', async () => {
    const admin = await loginAgent('break-glass', BREAK_GLASS_PASSWORD);
    const customerId = await seedCustomer(admin, 'Both Directions Co');
    const created = await admin
      .post(`/crm/customers/${customerId}/contacts`)
      .send({ name: 'Accounts Payable', email: 'ap@example.com' });
    const contactId = created.body.id as string;

    const unnamed = await admin
      .patch(`/crm/customers/${customerId}/contacts/${contactId}`)
      .send({ name: null, lockVersion: 1 });
    expect(unnamed.status).toBe(200);
    expect(unnamed.body.name).toBeNull();

    const emptied = await admin
      .patch(`/crm/customers/${customerId}/contacts/${contactId}`)
      .send({ email: null, lockVersion: unnamed.body.lockVersion });
    expect(emptied.status).toBe(400);
    expect(emptied.body.reason).toBe('contact-needs-name-or-email');
  });
});

describe('CRM contacts - concurrent edits', () => {
  it('refuses a PATCH with no token rather than falling back to last-write-wins', async () => {
    const admin = await loginAgent('break-glass', BREAK_GLASS_PASSWORD);
    const customerId = await seedCustomer(admin, 'No Token Co');
    const created = await admin
      .post(`/crm/customers/${customerId}/contacts`)
      .send({ name: 'Jane' });

    const patched = await admin
      .patch(`/crm/customers/${customerId}/contacts/${created.body.id}`)
      .send({ name: 'Renamed' });

    expect(patched.status).toBe(400);
  });

  it('409s a PATCH written against a generation somebody else moved on', async () => {
    const admin = await loginAgent('break-glass', BREAK_GLASS_PASSWORD);
    const customerId = await seedCustomer(admin, 'Two Editors Co');
    const created = await admin
      .post(`/crm/customers/${customerId}/contacts`)
      .send({ name: 'Jane' });
    const contactId = created.body.id as string;
    expect(created.body.lockVersion).toBe(1);

    const first = await admin
      .patch(`/crm/customers/${customerId}/contacts/${contactId}`)
      .send({ email: 'corrected@example.com', lockVersion: 1 });
    expect(first.status).toBe(200);
    expect(first.body.lockVersion).toBe(2);

    const stale = await admin
      .patch(`/crm/customers/${customerId}/contacts/${contactId}`)
      .send({ phone: '360-555-0173', lockVersion: 1 });

    expect(stale.status).toBe(409);
    expect(stale.body).toMatchObject({
      reason: 'stale-aggregate',
      value: { expected: 1, actual: 2 },
    });

    const list = await admin.get(`/crm/customers/${customerId}/contacts`);
    expect(list.body.items[0].email).toBe('corrected@example.com');
  });

  it('400s a DELETE with no token, and 409s one written against a stale generation', async () => {
    const admin = await loginAgent('break-glass', BREAK_GLASS_PASSWORD);
    const customerId = await seedCustomer(admin, 'Stale Delete Co');
    const created = await admin
      .post(`/crm/customers/${customerId}/contacts`)
      .send({ name: 'Jane' });
    const contactId = created.body.id as string;

    expect((await admin.delete(`/crm/customers/${customerId}/contacts/${contactId}`)).status).toBe(
      400,
    );

    await admin
      .patch(`/crm/customers/${customerId}/contacts/${contactId}`)
      .send({ name: 'Corrected', lockVersion: 1 });

    const stale = await admin
      .delete(`/crm/customers/${customerId}/contacts/${contactId}`)
      .send({ lockVersion: 1 });
    expect(stale.status).toBe(409);
    expect(stale.body).toMatchObject({ reason: 'stale-aggregate' });

    const list = await admin.get(`/crm/customers/${customerId}/contacts`);
    expect(list.body.items).toHaveLength(1);
  });

  it('creates without a token, because a create has no generation to be stale against', async () => {
    const admin = await loginAgent('break-glass', BREAK_GLASS_PASSWORD);
    const customerId = await seedCustomer(admin, 'Create Exempt Co');

    const created = await admin
      .post(`/crm/customers/${customerId}/contacts`)
      .send({ name: 'Jane' });

    expect(created.status).toBe(201);
    expect(created.body.lockVersion).toBe(1);
  });

  it('leaves the customer generation alone when a contact is written', async () => {
    const admin = await loginAgent('break-glass', BREAK_GLASS_PASSWORD);
    const customerId = await seedCustomer(admin, 'Independent Tokens Co');
    const before = await admin.get(`/crm/customers/${customerId}`);
    const created = await admin
      .post(`/crm/customers/${customerId}/contacts`)
      .send({ name: 'Jane' });
    const contactId = created.body.id as string;

    await admin
      .patch(`/crm/customers/${customerId}/contacts/${contactId}`)
      .send({ name: 'Renamed', lockVersion: 1 });
    await admin
      .delete(`/crm/customers/${customerId}/contacts/${contactId}`)
      .send({ lockVersion: 2 });

    const after = await admin.get(`/crm/customers/${customerId}`);
    expect(after.body.lockVersion).toBe(before.body.lockVersion);
  });
});

describe('CRM contacts - roles through the real edge', () => {
  it('tags a contact, shows the provenance, and lets two hold the same tag', async () => {
    const admin = await loginAgent('break-glass', BREAK_GLASS_PASSWORD);
    const customerId = await seedCustomer(admin, 'Tagged Corp');

    const jane = await admin
      .post(`/crm/customers/${customerId}/contacts`)
      .send({ name: 'Alex Demo', email: 'jane@example.com' });
    expect(jane.body.roles.map((r: { role: string }) => r.role)).toEqual([
      'quote',
      'order_confirmation',
    ]);

    const amy = await admin
      .post(`/crm/customers/${customerId}/contacts`)
      .send({ name: 'Amy Demo', email: 'amy@example.com' });
    const tagged = await admin
      .patch(`/crm/customers/${customerId}/contacts/${amy.body.id}`)
      .send({ roles: ['quote', 'order_confirmation'], lockVersion: amy.body.lockVersion });
    expect(tagged.status).toBe(200);
    expect(tagged.body.roles.map((r: { role: string }) => r.role)).toEqual([
      'quote',
      'order_confirmation',
    ]);

    expect(tagged.body.roles[0].setBy).toBe('break-glass');
    expect(tagged.body.rolesGivenUp).toEqual([]);

    const list = await admin.get(`/crm/customers/${customerId}/contacts`);
    const quoteHolders = list.body.items.filter((c: { roles: { role: string }[] }) =>
      c.roles.some((r) => r.role === 'quote'),
    );
    expect(quoteHolders.map((c: { id: string }) => c.id).sort()).toEqual(
      [jane.body.id, amy.body.id].sort(),
    );
  });

  it('answers 422 contact-role-unreachable for a tag the contact cannot carry', async () => {
    const admin = await loginAgent('break-glass', BREAK_GLASS_PASSWORD);
    const customerId = await seedCustomer(admin, 'Unreachable Corp');
    const foreman = await admin
      .post(`/crm/customers/${customerId}/contacts`)
      .send({ name: 'Foreman', phone: '360-555-0162' });

    const refused = await admin
      .patch(`/crm/customers/${customerId}/contacts/${foreman.body.id}`)
      .send({ roles: ['order_confirmation'], lockVersion: foreman.body.lockVersion });

    expect(refused.status).toBe(422);
    expect(refused.body.reason).toBe('contact-role-unreachable');
  });

  it('reports the tags a cleared address took with it', async () => {
    const admin = await loginAgent('break-glass', BREAK_GLASS_PASSWORD);
    const customerId = await seedCustomer(admin, 'Given Up Corp');
    const jane = await admin
      .post(`/crm/customers/${customerId}/contacts`)
      .send({ name: 'Jane', email: 'jane@example.com', phone: '360-555-0162' });

    const cleared = await admin
      .patch(`/crm/customers/${customerId}/contacts/${jane.body.id}`)
      .send({ email: null, lockVersion: jane.body.lockVersion });

    expect(cleared.status).toBe(200);
    expect(cleared.body.rolesGivenUp).toEqual(['quote', 'order_confirmation']);
    expect(cleared.body.roles).toEqual([]);
  });

  it('tags a second contact without disturbing the first', async () => {
    const admin = await loginAgent('break-glass', BREAK_GLASS_PASSWORD);
    const customerId = await seedCustomer(admin, 'Two Holders Corp');
    const jane = await admin
      .post(`/crm/customers/${customerId}/contacts`)
      .send({ name: 'Jane', email: 'jane@example.com' });
    const amy = await admin
      .post(`/crm/customers/${customerId}/contacts`)
      .send({ name: 'Amy', email: 'amy@example.com', phone: '360-555-0162' });
    await admin
      .patch(`/crm/customers/${customerId}/contacts/${jane.body.id}`)
      .send({ roles: ['quote', 'order_confirmation', 'production'], lockVersion: 1 });

    const tagged = await admin
      .patch(`/crm/customers/${customerId}/contacts/${amy.body.id}`)
      .send({ roles: ['order_confirmation'], lockVersion: amy.body.lockVersion });

    expect(tagged.status).toBe(200);
    expect(tagged.body.roles.map((r: { role: string }) => r.role)).toEqual(['order_confirmation']);
    expect(tagged.body.roles[0].setBy).toBe('break-glass');
    const list = await admin.get(`/crm/customers/${customerId}/contacts`);
    const stillJane = list.body.items.find((c: { id: string }) => c.id === jane.body.id);
    expect(stillJane.roles.map((r: { role: string }) => r.role)).toEqual([
      'quote',
      'order_confirmation',
      'production',
    ]);

    expect(
      list.body.items.filter((c: { roles: { role: string }[] }) =>
        c.roles.some((r) => r.role === 'order_confirmation'),
      ),
    ).toHaveLength(2);
  });
});
