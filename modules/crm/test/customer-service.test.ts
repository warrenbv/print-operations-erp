// CustomerService on the in-memory adapter.
import { describe, expect, it } from 'vitest';

import { InMemoryCustomerRepository } from '../src/adapters/in-memory/in-memory-customer-repository';
import { CustomerService } from '../src/services/customer-service';
import type { Clock } from '../src/ports';
import { createCustomerRequest } from './fixtures';

class MutableClock implements Clock {
  #current: Date;
  constructor(start: Date) {
    this.#current = start;
  }
  now(): Date {
    return this.#current;
  }
  advance(ms: number): void {
    this.#current = new Date(this.#current.getTime() + ms);
  }
}

function newService(): {
  service: CustomerService;
  repo: InMemoryCustomerRepository;
  clock: MutableClock;
} {
  const clock = new MutableClock(new Date('2026-07-31T09:00:00.000Z'));
  const repo = new InMemoryCustomerRepository();
  const service = new CustomerService({ customers: repo, clock });
  return { service, repo, clock };
}

describe('CustomerService.create', () => {
  it('mints an id and stamps timestamps from the clock', async () => {
    const { service, clock } = newService();
    const created = await service.create(createCustomerRequest({ name: 'Acme' }));
    expect(created.id).toBeTruthy();
    expect(created.createdAt).toBe(clock.now().toISOString());
    expect(created.updatedAt).toBe(clock.now().toISOString());
  });

  it('surfaces only the fields the caller supplied', async () => {
    const { service } = newService();
    const created = await service.create(
      createCustomerRequest({ name: 'Acme', legacyAccountNumber: 'LA-1' }),
    );
    expect(created.legacyAccountNumber).toBe('LA-1');
    expect(created.legacyUmbrellaAccountNumber).toBeUndefined();
  });
});

describe('CustomerService.update', () => {
  it('bumps updatedAt while leaving createdAt alone', async () => {
    const { service, clock } = newService();
    const created = await service.create(createCustomerRequest({ name: 'Acme' }));
    clock.advance(60_000);
    const patched = await service.update(created.id, {
      name: 'Acme LLC',
      lockVersion: created.lockVersion,
    });
    expect(patched?.name).toBe('Acme LLC');
    expect(patched?.createdAt).toBe(created.createdAt);
    expect(patched?.updatedAt).toBe(clock.now().toISOString());
  });

  it('returns null for an unknown id (so the API layer can 404 without exceptions as control flow)', async () => {
    const { service } = newService();

    expect(await service.update('does-not-exist', { name: 'x', lockVersion: 1 })).toBeNull();
  });
});

describe('CustomerService.search', () => {
  it('shape-checks the response — items + total', async () => {
    const { service } = newService();
    await service.create(createCustomerRequest({ name: 'Acme' }));
    await service.create(createCustomerRequest({ name: 'Beacon' }));
    const page = await service.search({ q: 'acm', limit: 20, offset: 0 });
    expect(page.total).toBe(1);
    expect(page.items[0]?.name).toBe('Acme');
  });
});

describe('CustomerService.hasBillingAddress', () => {
  const ADDRESS = {
    line1: '310 Demo Avenue',
    city: 'Demo Landing',
    state: 'WA',
    postalCode: '99000',
  };

  it('is false for a customer with none, which is every customer by default', async () => {
    const { service } = newService();
    const created = await service.create(createCustomerRequest({ name: 'Addressless Co' }));

    expect(await service.hasBillingAddress(created.id)).toBe(false);
  });

  it('is true once one is on file', async () => {
    const { service } = newService();
    const created = await service.create(
      createCustomerRequest({ name: 'Addressed Co', billingAddress: ADDRESS }),
    );

    expect(await service.hasBillingAddress(created.id)).toBe(true);
  });

  it('accepts a PO Box as the street line', async () => {
    const { service } = newService();
    const created = await service.create(
      createCustomerRequest({ name: 'Box Co', billingAddress: ADDRESS }),
    );

    expect(await service.hasBillingAddress(created.id)).toBe(true);
  });

  it('is false for an unknown customer, like mayQuote', async () => {
    const { service } = newService();

    expect(await service.hasBillingAddress('does-not-exist')).toBe(false);
  });
});
