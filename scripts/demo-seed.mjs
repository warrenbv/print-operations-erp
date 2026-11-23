// Seeds the demonstration's two fictional customers through the API as the Sales account, so the data
// passes the same validation and role checks as anything typed on screen. Each contact is tagged for
// quotes, which a quote needs before it can be sent: docs/product/requirements.md (R1).
import { demoPassword } from './demo-config.mjs';

export const demoCustomers = [
  {
    name: 'Northstar Demo Packaging',
    number: 'DEMO-1001',
    contact: 'Alex Demo',
    email: 'alex@example.test',
    street: '410 Harbor Lane',
    city: 'Demo Falls',
    postalCode: '83010',
  },
  {
    name: 'Cedar Demo Outfitters',
    number: 'DEMO-1002',
    contact: 'Morgan Sample',
    email: 'morgan@example.test',
    street: '77 Orchard Street',
    city: 'Sample Springs',
    postalCode: '83020',
  },
];

export async function seedDemo(base) {
  // Refuses any address but loopback HTTP, so it can never write to a real server.
  const url = new URL(base);
  if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
    throw new Error('Demo seeding is limited to loopback HTTP.');
  const login = await fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'dev-sales', password: demoPassword }),
  });
  if (login.status !== 200) throw new Error(`Demo sign-in failed (${login.status}).`);
  const cookie = login.headers.get('set-cookie')?.split(';')[0];
  if (!cookie) throw new Error('Demo sign-in did not create a session.');
  async function call(method, route, body, expected) {
    const response = await fetch(base + route, {
      method,
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify(body),
    });
    if (response.status !== expected)
      throw new Error(`Demo seed ${route} failed (${response.status}): ${await response.text()}`);
    return response.json();
  }
  for (const example of demoCustomers) {
    const customer = await call(
      'POST',
      '/crm/customers',
      {
        name: example.name,
        legacyAccountNumber: example.number,
        accountRepUsername: 'dev-sales',
        billingAddress: {
          line1: example.street,
          city: example.city,
          state: 'ID',
          postalCode: example.postalCode,
        },
      },
      201,
    );
    const contact = await call(
      'POST',
      `/crm/customers/${customer.id}/contacts`,
      { name: example.contact, email: example.email },
      201,
    );
    await call(
      'PATCH',
      `/crm/customers/${customer.id}/contacts/${contact.id}`,
      {
        roles: ['quote', 'order_confirmation', 'production'],
        lockVersion: contact.lockVersion,
      },
      200,
    );
  }
}
