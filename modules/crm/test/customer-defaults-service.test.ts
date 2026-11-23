// CustomerDefaultsService on in-memory adapters: empty defaults at version 0, saves and agreed prices.
import { StaleAggregateError } from '@erp/db';
import { describe, expect, it } from 'vitest';

import { InMemoryCustomerDefaultsRepository } from '../src/adapters/in-memory/in-memory-customer-defaults-repository';
import { InMemoryCustomerRepository } from '../src/adapters/in-memory/in-memory-customer-repository';
import { CustomerDefaultsService } from '../src/services/customer-defaults-service';
import { newCustomerInput } from './fixtures';

const NOW = new Date('2026-09-28T09:00:00.000Z');
const KRAFT = '01988a00-0583-7000-8000-000000000001';

async function fixture(): Promise<{ service: CustomerDefaultsService; customerId: string }> {
  const customers = new InMemoryCustomerRepository();
  const service = new CustomerDefaultsService({
    defaults: new InMemoryCustomerDefaultsRepository(),
    customers,
    clock: { now: () => NOW },
  });
  const created = await customers.create(
    newCustomerInput({ id: 'cust-1', name: 'Acme', createdAt: NOW, updatedAt: NOW }),
  );
  return { service, customerId: created.id };
}

describe('CustomerDefaultsService.find', () => {
  it('reads an account nobody has set up as no defaults at generation 0', async () => {
    const { service, customerId } = await fixture();
    expect(await service.find(customerId)).toEqual({ customerId, parts: [], lockVersion: 0 });
  });

  it('answers null for a customer that does not exist', async () => {
    const { service } = await fixture();
    expect(await service.find('no-such-customer')).toBeNull();
  });
});

describe('CustomerDefaultsService.replace', () => {
  it('saves the set and stamps the saver and the time', async () => {
    const { service, customerId } = await fixture();

    const result = await service.replace(
      customerId,
      {
        pricingBasis: 'per_pound',
        tierCode: 'list',
        freightMode: 'our_vehicle',
        leadTimeDays: 7,

        parts: [{ gradeId: KRAFT, rollWidthIn: 36, partNumber: 'LN-34', feetPerRoll: '1480' }],
        lockVersion: 0,
      },
      'jsmith',
    );

    expect(result).toEqual({
      ok: true,
      defaults: {
        customerId,
        pricingBasis: 'per_pound',
        tierCode: 'list',
        freightMode: 'our_vehicle',
        leadTimeDays: 7,
        parts: [{ gradeId: KRAFT, rollWidthIn: 36, partNumber: 'LN-34', feetPerRoll: '1480.0000' }],
        lockVersion: 1,
        updatedBy: 'jsmith',
        updatedAt: NOW.toISOString(),
      },
    });
    expect((await service.find(customerId))?.lockVersion).toBe(1);
  });

  it('names a missing customer rather than writing', async () => {
    const { service } = await fixture();
    expect(
      await service.replace('no-such-customer', { parts: [], lockVersion: 0 }, 'jsmith'),
    ).toEqual({
      ok: false,
      reason: 'customer-not-found',
    });
  });

  it('lets a stale generation through as StaleAggregateError for the edge to 409', async () => {
    const { service, customerId } = await fixture();
    await service.replace(customerId, { parts: [], lockVersion: 0 }, 'jsmith');
    await expect(
      service.replace(customerId, { parts: [], lockVersion: 0 }, 'kjones'),
    ).rejects.toBeInstanceOf(StaleAggregateError);
  });

  it('neither sets, changes nor keeps alive an agreed price from the parts it is sent', async () => {
    const { service, customerId } = await fixture();
    await service.replace(
      customerId,
      { parts: [{ gradeId: KRAFT, rollWidthIn: 12, partNumber: 'TEST-12' }], lockVersion: 0 },
      'jsmith',
    );
    const smuggled = {
      gradeId: KRAFT,
      rollWidthIn: 12,
      partNumber: 'TEST-12',
      agreedPrice: {
        basis: 'per_pound',
        price: '0.0425',
        setBy: 'jsmith',
        setAt: NOW.toISOString(),
      },
    };

    await service.replace(customerId, { parts: [smuggled], lockVersion: 1 }, 'jsmith');
    expect((await service.find(customerId))?.parts[0]?.agreedPrice).toBeUndefined();

    await service.setAgreedPrice(
      customerId,
      {
        gradeId: KRAFT,
        rollWidthIn: 12,
        agreedPrice: { basis: 'per_pound', price: '0.69' },
        lockVersion: 2,
      },
      'dev-billing',
    );
    await service.replace(customerId, { parts: [smuggled], lockVersion: 3 }, 'jsmith');
    expect((await service.find(customerId))?.parts[0]?.agreedPrice).toMatchObject({
      price: '0.6900',
      setBy: 'dev-billing',
    });

    await service.replace(
      customerId,
      { parts: [{ ...smuggled, rollWidthIn: 12.3125 }], lockVersion: 4 },
      'jsmith',
    );
    expect((await service.find(customerId))?.parts[0]?.agreedPrice).toBeUndefined();
  });
});

describe('CustomerDefaultsService.setAgreedPrice', () => {
  async function withPart() {
    const made = await fixture();
    await made.service.replace(
      made.customerId,
      { parts: [{ gradeId: KRAFT, rollWidthIn: 12, partNumber: 'TEST-12' }], lockVersion: 0 },
      'jsmith',
    );
    return made;
  }

  it('stamps the actor from the caller and the time from the clock', async () => {
    const { service, customerId } = await withPart();

    const result = await service.setAgreedPrice(
      customerId,
      {
        gradeId: KRAFT,
        rollWidthIn: 12,
        agreedPrice: { basis: 'per_roll', price: '23.75' },
        lockVersion: 1,
      },
      'dev-billing',
    );

    expect(result).toMatchObject({ ok: true, defaults: { lockVersion: 2 } });
    expect((await service.find(customerId))?.parts[0]?.agreedPrice).toEqual({
      basis: 'per_roll',
      price: '23.7500',
      setBy: 'dev-billing',
      setAt: NOW.toISOString(),
    });
  });

  it('names a missing customer and a missing part rather than writing', async () => {
    const { service, customerId } = await withPart();
    const request = {
      gradeId: KRAFT,
      rollWidthIn: 24,
      agreedPrice: { basis: 'per_roll' as const, price: '23.75' },
      lockVersion: 1,
    };
    expect(await service.setAgreedPrice('no-such-customer', request, 'dev-billing')).toEqual({
      ok: false,
      reason: 'customer-not-found',
    });
    expect(await service.setAgreedPrice(customerId, request, 'dev-billing')).toEqual({
      ok: false,
      reason: 'part-not-found',
    });
  });

  it('lets a stale generation through as StaleAggregateError', async () => {
    const { service, customerId } = await withPart();
    await expect(
      service.setAgreedPrice(
        customerId,
        { gradeId: KRAFT, rollWidthIn: 12, agreedPrice: null, lockVersion: 0 },
        'dev-billing',
      ),
    ).rejects.toBeInstanceOf(StaleAggregateError);
  });
});

describe('CustomerDefaultsService.agreedPrice', () => {
  it('answers the basis and the figure for the matching part, and nothing otherwise', async () => {
    const { service, customerId } = await fixture();
    expect(await service.agreedPrice(customerId, KRAFT, 12)).toBeUndefined();

    await service.replace(
      customerId,
      {
        parts: [
          { gradeId: KRAFT, rollWidthIn: 12, partNumber: 'TEST-12' },
          { gradeId: KRAFT, rollWidthIn: 24, partNumber: 'TEST-24' },
        ],
        lockVersion: 0,
      },
      'jsmith',
    );
    await service.setAgreedPrice(
      customerId,
      {
        gradeId: KRAFT,
        rollWidthIn: 12,
        agreedPrice: { basis: 'per_pound', price: '0.69' },
        lockVersion: 1,
      },
      'dev-billing',
    );

    expect(await service.agreedPrice(customerId, KRAFT.toUpperCase(), 12)).toEqual({
      basis: 'per_pound',
      price: '0.6900',
    });
    expect(await service.agreedPrice(customerId, KRAFT, 24)).toBeUndefined();
    expect(await service.agreedPrice('no-such-customer', KRAFT, 12)).toBeUndefined();
  });
});
