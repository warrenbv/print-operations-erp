// What every CustomerRepository adapter must do, written once and run against both adapters by
// modules/crm/test/customer-repository.contract.test.ts. It covers search, the credit hold,
// addresses, clearing fields and lockVersion.
// A failure in only one adapter means the two disagree, the defect this layer exists to catch:
// docs/process/verifying-agent-written-code.md.
import { StaleAggregateError } from '@erp/db';
import { describe, expect, it } from 'vitest';

import { DuplicateLegacyAccountNumberError, type CustomerRepository } from '../../src/ports';
import { newCustomerInput } from '../fixtures';

export function customerRepositoryContract(makeRepo: () => Promise<CustomerRepository>): void {
  async function updateNow(
    repo: CustomerRepository,
    id: string,
    patch: Parameters<CustomerRepository['update']>[1],
    at: Date,
  ): Promise<Awaited<ReturnType<CustomerRepository['update']>>> {
    const current = await repo.findById(id);
    return repo.update(id, patch, at, current?.lockVersion ?? 1);
  }

  async function setCreditHoldNow(
    repo: CustomerRepository,
    id: string,
    held: boolean,
    actor: string,
    at: Date,
  ): Promise<Awaited<ReturnType<CustomerRepository['setCreditHold']>>> {
    const current = await repo.findById(id);
    return repo.setCreditHold(id, held, actor, at, current?.lockVersion ?? 1);
  }

  const ID_1 = '01988a00-0002-7000-8000-000000000001';
  const ID_2 = '01988a00-0002-7000-8000-000000000002';
  const ID_3 = '01988a00-0002-7000-8000-000000000003';
  const NOW = new Date('2026-08-06T09:00:00.000Z');
  const LATER = new Date('2026-08-06T09:01:00.000Z');

  describe('create', () => {
    it('returns the created customer with the defaults applied', async () => {
      const repo = await makeRepo();
      const created = await repo.create(
        newCustomerInput({ id: ID_1, name: 'Acme', createdAt: NOW, updatedAt: NOW }),
      );
      expect(created.name).toBe('Acme');
      expect(created.paymentTerms).toEqual({ netDays: 15 });
      expect(created.taxExempt).toBe(false);
      expect(created.reseller).toBe(false);
      expect(created.createdAt).toBe(NOW.toISOString());
    });

    it('omits absent optional fields rather than surfacing null', async () => {
      const repo = await makeRepo();
      const created = await repo.create(
        newCustomerInput({ id: ID_1, name: 'Acme', createdAt: NOW, updatedAt: NOW }),
      );
      expect(created.legacyAccountNumber).toBeUndefined();
      expect(created.taxJurisdiction).toBeUndefined();
      expect(created.taxExemptionDocRef).toBeUndefined();
    });

    it('round-trips non-default net terms and the tax fields', async () => {
      const repo = await makeRepo();
      const created = await repo.create(
        newCustomerInput({
          id: ID_1,
          name: 'Demo Printers',
          paymentTerms: { netDays: 45 },

          taxJurisdiction: 'WA-0202',
          taxExempt: true,
          taxExemptionDocRef: 'exempt-cert-2026.pdf',
          reseller: true,
          createdAt: NOW,
          updatedAt: NOW,
        }),
      );
      expect(created.paymentTerms).toEqual({ netDays: 45 });
      expect(created.taxJurisdiction).toBe('WA-0202');
      expect(created.taxExempt).toBe(true);
      expect(created.taxExemptionDocRef).toBe('exempt-cert-2026.pdf');
      expect(created.reseller).toBe(true);
    });

    it('round-trips the account rep, and leaves it absent when nobody is named', async () => {
      const repo = await makeRepo();
      const withRep = await repo.create(
        newCustomerInput({
          id: ID_1,
          accountRepUsername: 'jsmith',
          createdAt: NOW,
          updatedAt: NOW,
        }),
      );
      expect(withRep.accountRepUsername).toBe('jsmith');

      const without = await repo.create(
        newCustomerInput({ id: ID_2, createdAt: NOW, updatedAt: NOW }),
      );

      expect(without).not.toHaveProperty('accountRepUsername');
    });

    it('raises the typed error on a duplicate legacyAccountNumber', async () => {
      const repo = await makeRepo();
      await repo.create(
        newCustomerInput({
          id: ID_1,
          name: 'Acme',
          legacyAccountNumber: 'LA-1',
          createdAt: NOW,
          updatedAt: NOW,
        }),
      );
      await expect(
        repo.create(
          newCustomerInput({
            id: ID_2,
            name: 'Copycat',
            legacyAccountNumber: 'LA-1',
            createdAt: NOW,
            updatedAt: NOW,
          }),
        ),
      ).rejects.toBeInstanceOf(DuplicateLegacyAccountNumberError);
    });
  });

  describe('findById', () => {
    it('returns null for an unknown id', async () => {
      const repo = await makeRepo();
      expect(await repo.findById(ID_3)).toBeNull();
    });

    it('returns exactly what create returned', async () => {
      const repo = await makeRepo();
      const created = await repo.create(
        newCustomerInput({ id: ID_1, name: 'Acme', createdAt: NOW, updatedAt: NOW }),
      );
      expect(await repo.findById(created.id)).toEqual(created);
    });
  });

  describe('update', () => {
    it('returns null for an unknown id, rather than throwing', async () => {
      const repo = await makeRepo();
      expect(await updateNow(repo, ID_3, { name: 'Nope' }, LATER)).toBeNull();
    });

    it('applies a partial patch and stamps updatedAt, leaving createdAt alone', async () => {
      const repo = await makeRepo();
      const created = await repo.create(
        newCustomerInput({ id: ID_1, name: 'Acme', createdAt: NOW, updatedAt: NOW }),
      );
      const patched = await updateNow(repo, created.id, { name: 'Acme LLC' }, LATER);
      expect(patched?.name).toBe('Acme LLC');
      expect(patched?.updatedAt).toBe(LATER.toISOString());
      expect(patched?.createdAt).toBe(NOW.toISOString());
    });

    it('treats an empty patch as a no-op returning the current row', async () => {
      const repo = await makeRepo();
      const created = await repo.create(
        newCustomerInput({ id: ID_1, name: 'Acme', createdAt: NOW, updatedAt: NOW }),
      );
      const patched = await updateNow(repo, created.id, {}, LATER);
      expect(patched).toEqual(created);
    });

    it('treats an empty patch as a no-op whatever lockVersion it carries', async () => {
      const repo = await makeRepo();
      const created = await repo.create(
        newCustomerInput({ id: ID_1, name: 'Acme', createdAt: NOW, updatedAt: NOW }),
      );
      const renamed = await repo.update(
        created.id,
        { name: 'Acme LLC' },
        LATER,
        created.lockVersion,
      );

      const patched = await repo.update(created.id, {}, LATER, created.lockVersion);
      expect(patched).toEqual(renamed);
      expect(await repo.update(ID_2, {}, LATER, 1)).toBeNull();
    });

    it('swaps payment terms wholesale', async () => {
      const repo = await makeRepo();
      const created = await repo.create(
        newCustomerInput({ id: ID_1, name: 'Acme', createdAt: NOW, updatedAt: NOW }),
      );
      expect(created.paymentTerms).toEqual({ netDays: 15 });

      const changed = await updateNow(repo, created.id, { paymentTerms: { netDays: 45 } }, LATER);
      expect(changed?.paymentTerms).toEqual({ netDays: 45 });

      const back = await updateNow(repo, created.id, { paymentTerms: { netDays: 15 } }, LATER);
      expect(back?.paymentTerms).toEqual({ netDays: 15 });
    });

    it('leaves terms and tax untouched when the patch omits them', async () => {
      const repo = await makeRepo();
      const created = await repo.create(
        newCustomerInput({
          id: ID_1,
          name: 'Acme',
          taxExempt: true,
          createdAt: NOW,
          updatedAt: NOW,
        }),
      );
      const patched = await updateNow(repo, created.id, { name: 'Acme LLC' }, LATER);
      expect(patched?.paymentTerms).toEqual(created.paymentTerms);
      expect(patched?.taxExempt).toBe(true);
    });

    it('raises the typed error when a patch duplicates another account number', async () => {
      const repo = await makeRepo();
      await repo.create(
        newCustomerInput({
          id: ID_1,
          name: 'Acme',
          legacyAccountNumber: 'LA-1',
          createdAt: NOW,
          updatedAt: NOW,
        }),
      );
      const other = await repo.create(
        newCustomerInput({ id: ID_2, name: 'Beacon', createdAt: NOW, updatedAt: NOW }),
      );
      await expect(
        updateNow(repo, other.id, { legacyAccountNumber: 'LA-1' }, LATER),
      ).rejects.toBeInstanceOf(DuplicateLegacyAccountNumberError);
    });

    it('accepts setting an account number to the value it already holds', async () => {
      const repo = await makeRepo();
      const created = await repo.create(
        newCustomerInput({
          id: ID_1,
          name: 'Acme',
          legacyAccountNumber: 'LA-1',
          createdAt: NOW,
          updatedAt: NOW,
        }),
      );
      const patched = await updateNow(repo, created.id, { legacyAccountNumber: 'LA-1' }, LATER);
      expect(patched?.legacyAccountNumber).toBe('LA-1');
    });
  });

  describe('search', () => {
    async function seeded(): Promise<CustomerRepository> {
      const repo = await makeRepo();
      await repo.create(
        newCustomerInput({ id: ID_1, name: 'Acme', createdAt: NOW, updatedAt: NOW }),
      );
      await repo.create(
        newCustomerInput({ id: ID_2, name: 'Beacon', createdAt: NOW, updatedAt: NOW }),
      );
      return repo;
    }

    it('returns items and total with no filter', async () => {
      const page = await (await seeded()).search({ limit: 10, offset: 0 });
      expect(page.total).toBe(2);
      expect(page.items).toHaveLength(2);
    });

    it('filters case-insensitively on a name substring', async () => {
      const page = await (await seeded()).search({ q: 'acm', limit: 10, offset: 0 });
      expect(page.items.map((c) => c.name)).toEqual(['Acme']);
      expect(page.total).toBe(1);
    });

    it('orders by name so pagination is stable', async () => {
      const page = await (await seeded()).search({ limit: 10, offset: 0 });
      expect(page.items.map((c) => c.name)).toEqual(['Acme', 'Beacon']);
    });

    it('reports the filtered total, not the page size', async () => {
      const page = await (await seeded()).search({ limit: 1, offset: 0 });
      expect(page.items).toHaveLength(1);
      expect(page.total).toBe(2);
    });

    it('treats ILIKE metacharacters in the query as literals', async () => {
      const page = await (await seeded()).search({ q: '%', limit: 10, offset: 0 });
      expect(page.total).toBe(0);
    });

    it('resolves exactly the requested ids', async () => {
      const page = await (await seeded()).search({ ids: [ID_1], limit: 10, offset: 0 });
      expect(page.items.map((c) => c.id)).toEqual([ID_1]);
      expect(page.total).toBe(1);
    });

    it('ignores limit and offset — an id list is a lookup, not a page', async () => {
      const page = await (await seeded()).search({ ids: [ID_1, ID_2], limit: 1, offset: 1 });
      expect(page.items.map((c) => c.name)).toEqual(['Acme', 'Beacon']);
      expect(page.total).toBe(2);
    });

    it('skips ids that do not resolve, and counts what was found', async () => {
      const page = await (await seeded()).search({ ids: [ID_1, ID_3], limit: 10, offset: 0 });
      expect(page.items.map((c) => c.id)).toEqual([ID_1]);
      expect(page.total).toBe(1);
    });

    it('orders a lookup by name, like a search', async () => {
      const page = await (await seeded()).search({ ids: [ID_2, ID_1], limit: 10, offset: 0 });
      expect(page.items.map((c) => c.name)).toEqual(['Acme', 'Beacon']);
    });

    async function seededWithReps(): Promise<CustomerRepository> {
      const repo = await makeRepo();
      await repo.create(
        newCustomerInput({
          id: ID_1,
          name: 'Acme',
          accountRepUsername: 'jsmith',
          createdAt: NOW,
          updatedAt: NOW,
        }),
      );
      await repo.create(
        newCustomerInput({
          id: ID_2,
          name: 'Beacon',
          accountRepUsername: 'rlee',
          createdAt: NOW,
          updatedAt: NOW,
        }),
      );
      await repo.create(
        newCustomerInput({ id: ID_3, name: 'Cedar', createdAt: NOW, updatedAt: NOW }),
      );
      return repo;
    }

    it('returns only the accounts a rep holds', async () => {
      const page = await (
        await seededWithReps()
      ).search({
        accountRepUsername: 'jsmith',
        limit: 10,
        offset: 0,
      });
      expect(page.items.map((c) => c.name)).toEqual(['Acme']);
      expect(page.total).toBe(1);
    });

    it('leaves an account with no rep out of every rep filter', async () => {
      const page = await (
        await seededWithReps()
      ).search({
        accountRepUsername: 'nobody',
        limit: 10,
        offset: 0,
      });
      expect(page.items).toEqual([]);
      expect(page.total).toBe(0);
    });

    it('matches the rep exactly, where the name matches loosely', async () => {
      const page = await (
        await seededWithReps()
      ).search({
        accountRepUsername: 'jsmit',
        limit: 10,
        offset: 0,
      });
      expect(page.total).toBe(0);
    });

    async function seededWithNumbers(): Promise<CustomerRepository> {
      const repo = await makeRepo();
      await repo.create(
        newCustomerInput({
          id: ID_1,
          name: 'Acme',
          legacyAccountNumber: 'LA-5264',
          legacyUmbrellaAccountNumber: 'UMB-736',
          createdAt: NOW,
          updatedAt: NOW,
        }),
      );
      await repo.create(
        newCustomerInput({
          id: ID_2,
          name: 'Beacon',
          legacyAccountNumber: 'LA-3817',
          createdAt: NOW,
          updatedAt: NOW,
        }),
      );
      return repo;
    }

    it('matches the legacy account number', async () => {
      const page = await (
        await seededWithNumbers()
      ).search({
        q: 'LA-5264',
        limit: 10,
        offset: 0,
      });
      expect(page.items.map((c) => c.name)).toEqual(['Acme']);
      expect(page.total).toBe(1);
    });

    it('matches part of an account number, because that is what people type', async () => {
      const page = await (await seededWithNumbers()).search({ q: '3817', limit: 10, offset: 0 });
      expect(page.items.map((c) => c.name)).toEqual(['Beacon']);
    });

    it('matches the umbrella number', async () => {
      const page = await (await seededWithNumbers()).search({ q: 'umb-736', limit: 10, offset: 0 });
      expect(page.items.map((c) => c.name)).toEqual(['Acme']);
    });

    it('still matches the name, and matches it case-insensitively', async () => {
      const page = await (await seededWithNumbers()).search({ q: 'acm', limit: 10, offset: 0 });
      expect(page.items.map((c) => c.name)).toEqual(['Acme']);
    });

    it('keeps ILIKE metacharacters literal in a number search too', async () => {
      const page = await (await seededWithNumbers()).search({ q: 'LA-%', limit: 10, offset: 0 });
      expect(page.total).toBe(0);
    });

    it('counts the widened match, so the paginator agrees with the rows', async () => {
      const page = await (await seededWithNumbers()).search({ q: 'LA-', limit: 1, offset: 0 });
      expect(page.items).toHaveLength(1);
      expect(page.total).toBe(2);
    });

    it('combines the rep with the name search, in both the rows and the total', async () => {
      const repo = await seededWithReps();
      expect(
        (await repo.search({ accountRepUsername: 'jsmith', q: 'acm', limit: 10, offset: 0 })).total,
      ).toBe(1);

      const mismatched = await repo.search({
        accountRepUsername: 'jsmith',
        q: 'beacon',
        limit: 10,
        offset: 0,
      });
      expect(mismatched.items).toEqual([]);
      expect(mismatched.total).toBe(0);
    });

    async function seededWithHolds(): Promise<CustomerRepository> {
      const repo = await seededWithReps();

      await setCreditHoldNow(repo, ID_1, true, 'bmanager', NOW);
      await setCreditHoldNow(repo, ID_2, true, 'bmanager', NOW);
      return repo;
    }

    it('returns only the held accounts under creditHold true', async () => {
      const page = await (
        await seededWithHolds()
      ).search({ creditHold: true, limit: 10, offset: 0 });
      expect(page.items.map((c) => c.name)).toEqual(['Acme', 'Beacon']);
      expect(page.total).toBe(2);
    });

    it('returns only the clear accounts under creditHold false', async () => {
      const page = await (
        await seededWithHolds()
      ).search({ creditHold: false, limit: 10, offset: 0 });
      expect(page.items.map((c) => c.name)).toEqual(['Cedar']);
      expect(page.total).toBe(1);
    });

    it('combines the hold with the rep, in both the rows and the total', async () => {
      const repo = await seededWithHolds();
      const janes = await repo.search({
        creditHold: true,
        accountRepUsername: 'jsmith',
        limit: 10,
        offset: 0,
      });
      expect(janes.items.map((c) => c.name)).toEqual(['Acme']);
      expect(janes.total).toBe(1);

      const rowansClear = await repo.search({
        creditHold: false,
        accountRepUsername: 'rlee',
        limit: 10,
        offset: 0,
      });
      expect(rowansClear.items).toEqual([]);
      expect(rowansClear.total).toBe(0);
    });

    it('counts every held account, not the page', async () => {
      const page = await (
        await seededWithHolds()
      ).search({ creditHold: true, limit: 1, offset: 0 });
      expect(page.items).toHaveLength(1);
      expect(page.total).toBe(2);
    });
  });

  describe('listNames', () => {
    async function seeded(): Promise<CustomerRepository> {
      const repo = await makeRepo();
      await repo.create(
        newCustomerInput({
          id: ID_2,
          name: 'Beacon',
          legacyAccountNumber: 'LA-3817',
          createdAt: NOW,
          updatedAt: NOW,
        }),
      );
      await repo.create(
        newCustomerInput({ id: ID_1, name: 'Acme', createdAt: NOW, updatedAt: NOW }),
      );
      return repo;
    }

    it('answers every account as id, name and account number', async () => {
      const page = await (await seeded()).listNames(10);
      expect(page.items).toEqual([
        { id: ID_1, name: 'Acme' },
        { id: ID_2, name: 'Beacon', legacyAccountNumber: 'LA-3817' },
      ]);
    });

    it('omits an absent account number rather than surfacing null', async () => {
      const [first] = (await (await seeded()).listNames(10)).items;
      expect(first).not.toHaveProperty('legacyAccountNumber');
    });

    it('orders by name, so the list reads the same on every load', async () => {
      const page = await (await seeded()).listNames(10);
      expect(page.items.map((c) => c.name)).toEqual(['Acme', 'Beacon']);
    });

    it('treats the limit as a ceiling and still reports the whole base', async () => {
      const page = await (await seeded()).listNames(1);
      expect(page.items.map((c) => c.name)).toEqual(['Acme']);
      expect(page.total).toBe(2);
    });

    it('answers an empty list, not null, for an empty base', async () => {
      const page = await (await makeRepo()).listNames(10);
      expect(page.items).toEqual([]);
      expect(page.total).toBe(0);
    });
  });

  describe('setCreditHold', () => {
    const HELD_AT = new Date('2026-08-19T18:00:00.000Z');

    async function withCustomer(): Promise<CustomerRepository> {
      const repo = await makeRepo();
      await repo.create(
        newCustomerInput({ id: ID_1, name: 'Acme', createdAt: HELD_AT, updatedAt: HELD_AT }),
      );
      return repo;
    }

    it('starts every customer un-held, with no actor', async () => {
      const repo = await withCustomer();

      const found = await repo.findById(ID_1);

      expect(found?.creditHold).toBe(false);
      expect(found?.creditHoldSetBy).toBeUndefined();
      expect(found?.creditHoldSetAt).toBeUndefined();
    });

    it('records who set the hold and when', async () => {
      const repo = await withCustomer();

      const held = await setCreditHoldNow(repo, ID_1, true, 'bmanager', HELD_AT);

      expect(held).toMatchObject({ creditHold: true, creditHoldSetBy: 'bmanager' });
      expect(held?.creditHoldSetAt).toBe(HELD_AT.toISOString());
    });

    it('keeps the attribution when the hold is cleared', async () => {
      const repo = await withCustomer();
      await setCreditHoldNow(repo, ID_1, true, 'bmanager', HELD_AT);
      const clearedAt = new Date(HELD_AT.getTime() + 86_400_000);

      const cleared = await setCreditHoldNow(repo, ID_1, false, 'someone-else', clearedAt);

      expect(cleared).toMatchObject({ creditHold: false, creditHoldSetBy: 'someone-else' });
      expect(cleared?.creditHoldSetAt).toBe(clearedAt.toISOString());
    });

    it('re-stamps a hold that is set again, rather than treating it as a no-op', async () => {
      const repo = await withCustomer();
      await setCreditHoldNow(repo, ID_1, true, 'bmanager', HELD_AT);
      const again = new Date(HELD_AT.getTime() + 3_600_000);

      const reaffirmed = await setCreditHoldNow(repo, ID_1, true, 'second-bm', again);

      expect(reaffirmed?.creditHoldSetBy).toBe('second-bm');
      expect(reaffirmed?.creditHoldSetAt).toBe(again.toISOString());
    });

    it('moves updatedAt, because the record changed', async () => {
      const repo = await withCustomer();

      const held = await setCreditHoldNow(repo, ID_1, true, 'bmanager', HELD_AT);

      expect(held?.updatedAt).toBe(HELD_AT.toISOString());
    });

    it('answers null for an unknown customer', async () => {
      const repo = await makeRepo();

      expect(await setCreditHoldNow(repo, ID_3, true, 'bmanager', HELD_AT)).toBeNull();
    });

    it('leaves the hold alone when an unrelated field is patched', async () => {
      const repo = await withCustomer();
      await setCreditHoldNow(repo, ID_1, true, 'bmanager', HELD_AT);

      await updateNow(repo, ID_1, { name: 'Acme Renamed' }, new Date());

      const found = await repo.findById(ID_1);
      expect(found).toMatchObject({ name: 'Acme Renamed', creditHold: true });
      expect(found?.creditHoldSetBy).toBe('bmanager');
    });
  });

  describe('billing address', () => {
    const ADDRESS = {
      name: 'Accounts Payable',
      line1: '310 Demo Avenue',
      line2: 'Attn: Alex Demo',
      city: 'Demo Landing',
      state: 'WA',
      postalCode: '99000',
    } as const;

    it('round-trips a complete address through create', async () => {
      const repo = await makeRepo();
      const created = await repo.create(
        newCustomerInput({ id: ID_1, createdAt: NOW, updatedAt: NOW, billingAddress: ADDRESS }),
      );
      expect(created.billingAddress).toEqual(ADDRESS);

      const read = await repo.findById(ID_1);
      expect(read?.billingAddress).toEqual(ADDRESS);
    });

    it('round-trips an address with only its required parts', async () => {
      const repo = await makeRepo();
      const minimal = {
        line1: '4471 Mill Road',
        city: 'Demo Falls',
        state: 'ID',
        postalCode: '83010',
      };
      const created = await repo.create(
        newCustomerInput({ id: ID_1, createdAt: NOW, updatedAt: NOW, billingAddress: minimal }),
      );

      expect(created.billingAddress).toEqual(minimal);
      expect(created.billingAddress).not.toHaveProperty('name');
      expect(created.billingAddress).not.toHaveProperty('line2');
    });

    it('omits the address entirely when the customer has none', async () => {
      const repo = await makeRepo();
      const created = await repo.create(
        newCustomerInput({ id: ID_1, createdAt: NOW, updatedAt: NOW }),
      );
      expect(created.billingAddress).toBeUndefined();
    });

    it('adds an address to a customer that had none', async () => {
      const repo = await makeRepo();
      await repo.create(newCustomerInput({ id: ID_1, createdAt: NOW, updatedAt: NOW }));
      const updated = await updateNow(repo, ID_1, { billingAddress: ADDRESS }, LATER);
      expect(updated?.billingAddress).toEqual(ADDRESS);
    });

    it('replaces the address wholesale, dropping optional parts the new one omits', async () => {
      const repo = await makeRepo();
      await repo.create(
        newCustomerInput({ id: ID_1, createdAt: NOW, updatedAt: NOW, billingAddress: ADDRESS }),
      );
      const replacement = {
        line1: '4471 Mill Road',
        city: 'Demo Falls',
        state: 'ID',
        postalCode: '83010',
      };
      const updated = await updateNow(repo, ID_1, { billingAddress: replacement }, LATER);

      expect(updated?.billingAddress).toEqual(replacement);
      expect(updated?.billingAddress).not.toHaveProperty('name');
      expect(updated?.billingAddress).not.toHaveProperty('line2');
    });

    it('leaves an existing address alone when the patch omits it', async () => {
      const repo = await makeRepo();
      await repo.create(
        newCustomerInput({ id: ID_1, createdAt: NOW, updatedAt: NOW, billingAddress: ADDRESS }),
      );
      const updated = await updateNow(repo, ID_1, { name: 'Acme LLC' }, LATER);
      expect(updated?.name).toBe('Acme LLC');
      expect(updated?.billingAddress).toEqual(ADDRESS);
    });

    it('keeps addresses apart between customers', async () => {
      const repo = await makeRepo();
      await repo.create(
        newCustomerInput({ id: ID_1, createdAt: NOW, updatedAt: NOW, billingAddress: ADDRESS }),
      );
      await repo.create(newCustomerInput({ id: ID_2, createdAt: NOW, updatedAt: NOW }));
      expect((await repo.findById(ID_1))?.billingAddress).toEqual(ADDRESS);
      expect((await repo.findById(ID_2))?.billingAddress).toBeUndefined();
    });
  });

  describe('shipping address', () => {
    const SHIP_TO = {
      name: 'Receiving',
      line1: '400 Warehouse Way',
      line2: 'Dock 3',
      city: 'Sample Harbor',
      state: 'WA',
      postalCode: '98000-6153',
    } as const;

    const BILL_TO = {
      name: 'Accounts Payable',
      line1: '310 Demo Avenue',
      city: 'Demo Landing',
      state: 'WA',
      postalCode: '99000',
    } as const;

    it('round-trips a complete address through create', async () => {
      const repo = await makeRepo();
      const created = await repo.create(
        newCustomerInput({ id: ID_1, createdAt: NOW, updatedAt: NOW, shippingAddress: SHIP_TO }),
      );
      expect(created.shippingAddress).toEqual(SHIP_TO);

      const read = await repo.findById(ID_1);
      expect(read?.shippingAddress).toEqual(SHIP_TO);
    });

    it('round-trips an address with only its required parts', async () => {
      const repo = await makeRepo();
      const minimal = {
        line1: '4471 Mill Road',
        city: 'Demo Falls',
        state: 'ID',
        postalCode: '83010',
      };
      const created = await repo.create(
        newCustomerInput({ id: ID_1, createdAt: NOW, updatedAt: NOW, shippingAddress: minimal }),
      );
      expect(created.shippingAddress).toEqual(minimal);
      expect(created.shippingAddress).not.toHaveProperty('name');
      expect(created.shippingAddress).not.toHaveProperty('line2');
    });

    it('omits the address entirely when the customer has none', async () => {
      const repo = await makeRepo();
      const created = await repo.create(
        newCustomerInput({ id: ID_1, createdAt: NOW, updatedAt: NOW }),
      );
      expect(created.shippingAddress).toBeUndefined();
    });

    it('holds a shipping and a billing address that are nothing like each other', async () => {
      const repo = await makeRepo();
      const created = await repo.create(
        newCustomerInput({
          id: ID_1,
          createdAt: NOW,
          updatedAt: NOW,
          billingAddress: BILL_TO,
          shippingAddress: SHIP_TO,
        }),
      );
      expect(created.billingAddress).toEqual(BILL_TO);
      expect(created.shippingAddress).toEqual(SHIP_TO);

      const read = await repo.findById(ID_1);
      expect(read?.billingAddress).toEqual(BILL_TO);
      expect(read?.shippingAddress).toEqual(SHIP_TO);
    });

    it('replaces the address wholesale, dropping optional parts the new one omits', async () => {
      const repo = await makeRepo();
      await repo.create(
        newCustomerInput({ id: ID_1, createdAt: NOW, updatedAt: NOW, shippingAddress: SHIP_TO }),
      );
      const replacement = {
        line1: '4471 Mill Road',
        city: 'Demo Falls',
        state: 'ID',
        postalCode: '83010',
      };
      const updated = await updateNow(repo, ID_1, { shippingAddress: replacement }, LATER);

      expect(updated?.shippingAddress).toEqual(replacement);
      expect(updated?.shippingAddress).not.toHaveProperty('name');
      expect(updated?.shippingAddress).not.toHaveProperty('line2');
    });

    it('leaves an existing address alone when the patch omits it', async () => {
      const repo = await makeRepo();
      await repo.create(
        newCustomerInput({ id: ID_1, createdAt: NOW, updatedAt: NOW, shippingAddress: SHIP_TO }),
      );
      const updated = await updateNow(repo, ID_1, { name: 'Acme LLC' }, LATER);
      expect(updated?.name).toBe('Acme LLC');
      expect(updated?.shippingAddress).toEqual(SHIP_TO);
    });

    it('changes one address without touching the other', async () => {
      const repo = await makeRepo();
      await repo.create(
        newCustomerInput({
          id: ID_1,
          createdAt: NOW,
          updatedAt: NOW,
          billingAddress: BILL_TO,
          shippingAddress: SHIP_TO,
        }),
      );
      const moved = {
        line1: '9 Riverside',
        city: 'Demo Port',
        state: 'OR',
        postalCode: '97000',
      };
      const updated = await updateNow(repo, ID_1, { shippingAddress: moved }, LATER);
      expect(updated?.shippingAddress).toEqual(moved);
      expect(updated?.billingAddress).toEqual(BILL_TO);
    });
  });

  describe('null clears an optional field', () => {
    const ADDRESS = {
      name: 'Accounts Payable',
      line1: '310 Demo Avenue',
      city: 'Demo Landing',
      state: 'WA',
      postalCode: '99000',
    } as const;

    const SHIP_TO = {
      name: 'Receiving',
      line1: '400 Warehouse Way',
      city: 'Sample Harbor',
      state: 'WA',
      postalCode: '98000',
    } as const;

    async function fullyPopulated(repo: CustomerRepository): Promise<void> {
      await repo.create(
        newCustomerInput({
          id: ID_1,
          createdAt: NOW,
          updatedAt: NOW,
          legacyAccountNumber: 'LA-1',
          legacyUmbrellaAccountNumber: 'LA-UMB',
          taxJurisdiction: 'WA-9010',
          taxExemptionDocRef: 'exempt-2026.pdf',
          freightMarginPct: '0.120000',
          accountRepUsername: 'jsmith',
          billingAddress: ADDRESS,
          shippingAddress: SHIP_TO,
        }),
      );
    }

    it.each([
      ['legacyAccountNumber'],
      ['legacyUmbrellaAccountNumber'],
      ['taxJurisdiction'],
      ['taxExemptionDocRef'],
      ['freightMarginPct'],

      ['accountRepUsername'],
    ] as const)('clears %s when sent null', async (field) => {
      const repo = await makeRepo();
      await fullyPopulated(repo);

      const updated = await updateNow(repo, ID_1, { [field]: null }, LATER);

      expect(updated).not.toBeNull();
      expect(updated).not.toHaveProperty(field);
    });

    it('clears the whole billing address when sent null', async () => {
      const repo = await makeRepo();
      await fullyPopulated(repo);

      const updated = await updateNow(repo, ID_1, { billingAddress: null }, LATER);

      expect(updated?.billingAddress).toBeUndefined();

      expect(updated?.shippingAddress).toEqual(SHIP_TO);
    });

    it('clears the whole shipping address when sent null', async () => {
      const repo = await makeRepo();
      await fullyPopulated(repo);

      const updated = await updateNow(repo, ID_1, { shippingAddress: null }, LATER);

      expect(updated?.shippingAddress).toBeUndefined();
      expect(updated?.billingAddress).toEqual(ADDRESS);
    });

    it('leaves every other field alone while clearing one', async () => {
      const repo = await makeRepo();
      await fullyPopulated(repo);

      const updated = await updateNow(repo, ID_1, { taxJurisdiction: null }, LATER);

      expect(updated?.taxJurisdiction).toBeUndefined();
      expect(updated?.legacyAccountNumber).toBe('LA-1');
      expect(updated?.taxExemptionDocRef).toBe('exempt-2026.pdf');
      expect(updated?.freightMarginPct).toBe('0.120000');
      expect(updated?.billingAddress).toEqual(ADDRESS);
    });

    it('distinguishes absent from null - omitting leaves the value alone', async () => {
      const repo = await makeRepo();
      await fullyPopulated(repo);

      const updated = await updateNow(repo, ID_1, { name: 'Renamed Co' }, LATER);

      expect(updated?.name).toBe('Renamed Co');
      expect(updated?.taxJurisdiction).toBe('WA-9010');
      expect(updated?.legacyAccountNumber).toBe('LA-1');
      expect(updated?.billingAddress).toEqual(ADDRESS);
    });

    it('frees the legacy account number for another customer once cleared', async () => {
      const repo = await makeRepo();
      await fullyPopulated(repo);
      await updateNow(repo, ID_1, { legacyAccountNumber: null }, LATER);

      const other = await repo.create(
        newCustomerInput({
          id: ID_2,
          createdAt: NOW,
          updatedAt: NOW,
          legacyAccountNumber: 'LA-1',
        }),
      );
      expect(other.legacyAccountNumber).toBe('LA-1');
    });

    it('re-sets a field after clearing it', async () => {
      const repo = await makeRepo();
      await fullyPopulated(repo);
      await updateNow(repo, ID_1, { billingAddress: null }, LATER);

      const restored = await updateNow(repo, ID_1, { billingAddress: ADDRESS }, LATER);
      expect(restored?.billingAddress).toEqual(ADDRESS);
    });
  });

  describe('lockVersion', () => {
    async function seeded(repo: CustomerRepository): Promise<string> {
      const created = await repo.create(
        newCustomerInput({ id: ID_1, name: 'Acme', createdAt: NOW, updatedAt: NOW }),
      );
      return created.id;
    }

    it('starts at 1 on a new customer', async () => {
      const repo = await makeRepo();
      const created = await repo.create(
        newCustomerInput({ id: ID_1, name: 'Acme', createdAt: NOW, updatedAt: NOW }),
      );
      expect(created.lockVersion).toBe(1);
    });

    it('applies a guarded update at the expected generation, and moves it', async () => {
      const repo = await makeRepo();
      const id = await seeded(repo);

      const updated = await repo.update(id, { name: 'Acme LLC' }, LATER, 1);

      expect(updated?.name).toBe('Acme LLC');
      expect(updated?.lockVersion).toBe(2);
    });

    it('refuses a guarded update at a stale generation, and writes nothing', async () => {
      const repo = await makeRepo();
      const id = await seeded(repo);
      await repo.update(id, { name: 'First In' }, LATER, 1);

      await expect(repo.update(id, { name: 'Second In' }, LATER, 1)).rejects.toBeInstanceOf(
        StaleAggregateError,
      );

      const after = await repo.findById(id);
      expect(after?.name).toBe('First In');
      expect(after?.lockVersion).toBe(2);
    });

    it('carries both generations on the refusal, because the recovery is human', async () => {
      const repo = await makeRepo();
      const id = await seeded(repo);
      await repo.update(id, { name: 'Moved On' }, LATER, 1);

      await expect(repo.update(id, { name: 'Stale' }, LATER, 1)).rejects.toMatchObject({
        aggregate: 'customer',
        expected: 1,
        actual: 2,
      });
    });

    it('still answers null for an unknown customer rather than raising staleness', async () => {
      const repo = await makeRepo();
      expect(await repo.update(ID_3, { name: 'Ghost' }, LATER, 1)).toBeNull();
    });

    it('leaves the token alone for a patch that changes nothing', async () => {
      const repo = await makeRepo();
      const id = await seeded(repo);

      const same = await repo.update(id, {}, LATER, 1);

      expect(same?.lockVersion).toBe(1);
    });

    it('moves the token when a credit hold is set', async () => {
      const repo = await makeRepo();
      const id = await seeded(repo);

      const held = await repo.setCreditHold(id, true, 'dev-billing', LATER, 1);

      expect(held?.creditHold).toBe(true);
      expect(held?.lockVersion).toBe(2);
      await expect(repo.update(id, { name: 'Stale Edit' }, LATER, 1)).rejects.toBeInstanceOf(
        StaleAggregateError,
      );
    });

    it('refuses a credit hold at a stale generation, and writes nothing', async () => {
      const repo = await makeRepo();
      const id = await seeded(repo);
      await repo.setCreditHold(id, true, 'dev-billing', LATER, 1);

      await expect(repo.setCreditHold(id, false, 'other-billing', LATER, 1)).rejects.toBeInstanceOf(
        StaleAggregateError,
      );

      const after = await repo.findById(id);
      expect(after?.creditHold).toBe(true);
      expect(after?.creditHoldSetBy).toBe('dev-billing');
    });

    it('moves the token on every successive write', async () => {
      const repo = await makeRepo();
      const id = await seeded(repo);

      const first = await repo.update(id, { name: 'One' }, LATER, 1);
      const second = await repo.update(id, { name: 'Two' }, LATER, first?.lockVersion ?? 0);
      const third = await repo.setCreditHold(
        id,
        true,
        'dev-billing',
        LATER,
        second?.lockVersion ?? 0,
      );

      expect([first?.lockVersion, second?.lockVersion, third?.lockVersion]).toEqual([2, 3, 4]);
    });
  });
}
