// Direct tests of InMemoryContactRepository beside the shared contract: create, listing per customer\n// by name, update and delete.
import { describe, expect, it } from 'vitest';

import { InMemoryContactRepository } from '../src/adapters/in-memory/in-memory-contact-repository';

const NOW = new Date('2026-08-03T09:00:00.000Z');
const CUSTOMER_A = 'cust-a';
const CUSTOMER_B = 'cust-b';

async function seed(): Promise<InMemoryContactRepository> {
  const repo = new InMemoryContactRepository();
  await repo.create({
    id: 'contact-1',
    customerId: CUSTOMER_A,
    name: 'Zeb',
    email: 'zeb@example.com',
    createdAt: NOW,
    updatedAt: NOW,
  });
  await repo.create({
    id: 'contact-2',
    customerId: CUSTOMER_A,
    name: 'Amy',
    phone: '360-555-0162',
    createdAt: NOW,
    updatedAt: NOW,
  });
  await repo.create({
    id: 'contact-3',
    customerId: CUSTOMER_B,
    name: 'Beacon Person',
    createdAt: NOW,
    updatedAt: NOW,
  });
  return repo;
}

describe('InMemoryContactRepository.create', () => {
  it('persists a contact with optional fields omitted', async () => {
    const repo = new InMemoryContactRepository();
    const created = await repo.create({
      id: 'c-1',
      customerId: CUSTOMER_A,
      name: 'Jane',
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect(created.name).toBe('Jane');
    expect(created.email).toBeUndefined();
    expect(created.phone).toBeUndefined();
  });
});

describe('InMemoryContactRepository.listByCustomer', () => {
  it("returns only that customer's contacts, sorted by name", async () => {
    const repo = await seed();
    const list = await repo.listByCustomer(CUSTOMER_A);
    expect(list.map((c) => c.name)).toEqual(['Amy', 'Zeb']);
  });

  it('returns an empty list for a customer with no contacts', async () => {
    const repo = await seed();
    const list = await repo.listByCustomer('cust-c');
    expect(list).toEqual([]);
  });
});

describe('InMemoryContactRepository.update', () => {
  it('returns null when the id is unknown', async () => {
    const repo = new InMemoryContactRepository();
    expect(await repo.update('missing', { name: 'x' }, NOW, 1)).toBeNull();
  });

  it('applies a partial patch and stamps updatedAt', async () => {
    const repo = await seed();
    const later = new Date(NOW.getTime() + 60_000);
    const patched = await repo.update('contact-1', { phone: '360-555-0148' }, later, 1);
    expect(patched?.phone).toBe('360-555-0148');

    expect(patched?.email).toBe('zeb@example.com');
    expect(patched?.updatedAt).toBe(later.toISOString());
  });
});

describe('InMemoryContactRepository.delete', () => {
  it('returns false when the id is unknown', async () => {
    const repo = new InMemoryContactRepository();
    expect(await repo.delete('missing', 1)).toBe(false);
  });

  it('returns true and removes the row when it existed', async () => {
    const repo = await seed();
    expect(await repo.delete('contact-1', 1)).toBe(true);
    expect(await repo.findById('contact-1')).toBeNull();
  });
});
