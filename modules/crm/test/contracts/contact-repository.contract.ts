// What every ContactRepository adapter must do, written once and run against both adapters by
// modules/crm/test/contact-repository.contract.test.ts. It covers nameless contacts, clearing
// fields, lockVersion, and the role set with its provenance.
// A failure in only one adapter means the two disagree, the defect this layer exists to catch:
// docs/process/verifying-agent-written-code.md.
import { describe, expect, it } from 'vitest';

import { MAIL_CONTACT_ROLES } from '@erp/types';

import type { ContactRepository, ContactRoleRow } from '../../src/ports';

export function contactRepositoryContract(
  makeRepo: () => Promise<{ contacts: ContactRepository; customerId: string }>,
): void {
  const ID_1 = '01988a00-0003-7000-8000-000000000001';
  const NOW = new Date('2026-08-06T09:00:00.000Z');
  const LATER = new Date('2026-08-06T09:01:00.000Z');

  function mailRoles(setBy: string, setAt: Date): ContactRoleRow[] {
    return MAIL_CONTACT_ROLES.map((role) => ({ role, setBy, setAt }));
  }

  async function updateNow(
    contacts: ContactRepository,
    id: string,
    patch: Parameters<ContactRepository['update']>[1],
    at: Date,
  ): Promise<Awaited<ReturnType<ContactRepository['update']>>> {
    const current = await contacts.findById(id);
    return contacts.update(id, patch, at, current?.lockVersion ?? 1);
  }

  describe('a contact with no name', () => {
    it('round-trips a null name through a fresh read', async () => {
      const { contacts, customerId } = await makeRepo();
      const created = await contacts.create({
        id: ID_1,
        customerId,
        name: null,
        email: 'ap@example.com',
        createdAt: NOW,
        updatedAt: NOW,
      });
      expect(created.name).toBeNull();
      const read = await contacts.findById(ID_1);
      expect(read?.name).toBeNull();
      expect(read?.email).toBe('ap@example.com');
    });

    it('clears a name when sent null, leaving the address', async () => {
      const { contacts, customerId } = await makeRepo();
      await contacts.create({
        id: ID_1,
        customerId,
        name: 'Accounts Payable',
        email: 'ap@example.com',
        createdAt: NOW,
        updatedAt: NOW,
      });
      const updated = await updateNow(contacts, ID_1, { name: null }, LATER);
      expect(updated?.name).toBeNull();
      expect((await contacts.findById(ID_1))?.email).toBe('ap@example.com');
    });

    it('lists a contact with no name after every named one', async () => {
      const { contacts, customerId } = await makeRepo();
      const ids = [
        '01988a00-0003-7000-8000-000000000011',
        '01988a00-0003-7000-8000-000000000012',
        '01988a00-0003-7000-8000-000000000013',
      ] as const;
      await contacts.create({
        id: ids[0],
        customerId,
        name: null,
        email: 'ap@example.com',
        createdAt: NOW,
        updatedAt: NOW,
      });
      await contacts.create({
        id: ids[1],
        customerId,
        name: 'Zoe',
        createdAt: NOW,
        updatedAt: NOW,
      });
      await contacts.create({
        id: ids[2],
        customerId,
        name: 'Abe',
        createdAt: NOW,
        updatedAt: NOW,
      });
      const listed = await contacts.listByCustomer(customerId);
      expect(listed.map((contact) => contact.name)).toEqual(['Abe', 'Zoe', null]);
    });
  });

  describe('null clears an optional field', () => {
    async function fullyPopulated(
      contacts: ContactRepository,
      customerId: string,
    ): Promise<string> {
      const created = await contacts.create({
        id: ID_1,
        customerId,
        name: 'Alex Demo',
        email: 'jane@example.com',
        phone: '360-555-0162',
        createdAt: NOW,
        updatedAt: NOW,
      });
      return created.id;
    }

    it.each([['email'], ['phone']] as const)('clears %s when sent null', async (field) => {
      const { contacts, customerId } = await makeRepo();
      const id = await fullyPopulated(contacts, customerId);

      const updated = await updateNow(contacts, id, { [field]: null }, LATER);

      expect(updated).not.toBeNull();
      expect(updated).not.toHaveProperty(field);
    });

    it('leaves the other field alone while clearing one', async () => {
      const { contacts, customerId } = await makeRepo();
      const id = await fullyPopulated(contacts, customerId);

      const updated = await updateNow(contacts, id, { email: null }, LATER);

      expect(updated?.email).toBeUndefined();
      expect(updated?.phone).toBe('360-555-0162');
      expect(updated?.name).toBe('Alex Demo');
    });

    it('clears both fields at once', async () => {
      const { contacts, customerId } = await makeRepo();
      const id = await fullyPopulated(contacts, customerId);

      const updated = await updateNow(contacts, id, { email: null, phone: null }, LATER);

      expect(updated?.email).toBeUndefined();
      expect(updated?.phone).toBeUndefined();
      expect(updated?.name).toBe('Alex Demo');
    });

    it('distinguishes absent from null - omitting leaves the value alone', async () => {
      const { contacts, customerId } = await makeRepo();
      const id = await fullyPopulated(contacts, customerId);

      const updated = await updateNow(contacts, id, { name: 'Jane Renamed' }, LATER);

      expect(updated?.name).toBe('Jane Renamed');
      expect(updated?.email).toBe('jane@example.com');
      expect(updated?.phone).toBe('360-555-0162');
    });

    it('re-sets a field after clearing it', async () => {
      const { contacts, customerId } = await makeRepo();
      const id = await fullyPopulated(contacts, customerId);
      await updateNow(contacts, id, { email: null }, LATER);

      const restored = await updateNow(contacts, id, { email: 'jane.new@example.com' }, LATER);
      expect(restored?.email).toBe('jane.new@example.com');
    });

    it('clears a field that is already absent without complaint', async () => {
      const { contacts, customerId } = await makeRepo();
      const created = await contacts.create({
        id: ID_1,
        customerId,
        name: 'Nameless Number',
        createdAt: NOW,
        updatedAt: NOW,
      });

      const updated = await updateNow(contacts, created.id, { phone: null }, LATER);

      expect(updated).not.toBeNull();
      expect(updated?.phone).toBeUndefined();
    });

    it('reads the cleared field back from a fresh lookup', async () => {
      const { contacts, customerId } = await makeRepo();
      const id = await fullyPopulated(contacts, customerId);
      await updateNow(contacts, id, { email: null }, LATER);

      const fetched = await contacts.findById(id);
      expect(fetched?.email).toBeUndefined();
      expect(fetched?.phone).toBe('360-555-0162');
    });
  });

  describe('lockVersion', () => {
    async function seed(
      contacts: ContactRepository,
      customerId: string,
    ): Promise<{ id: string; lockVersion: number }> {
      const created = await contacts.create({
        id: ID_1,
        customerId,
        name: 'Alex Demo',
        email: 'jane@example.com',
        phone: '360-555-0162',
        createdAt: NOW,
        updatedAt: NOW,
      });
      return { id: created.id, lockVersion: created.lockVersion };
    }

    it('creates at generation 1', async () => {
      const { contacts, customerId } = await makeRepo();
      const { lockVersion } = await seed(contacts, customerId);
      expect(lockVersion).toBe(1);
    });

    it('bumps on every write that changes a field', async () => {
      const { contacts, customerId } = await makeRepo();
      const { id } = await seed(contacts, customerId);

      const first = await contacts.update(id, { name: 'One' }, LATER, 1);
      const second = await contacts.update(id, { name: 'Two' }, LATER, first?.lockVersion ?? 0);

      expect([first?.lockVersion, second?.lockVersion]).toEqual([2, 3]);
    });

    it('refuses an update at a generation that has moved on', async () => {
      const { contacts, customerId } = await makeRepo();
      const { id } = await seed(contacts, customerId);
      await contacts.update(id, { name: 'One' }, LATER, 1);

      await expect(contacts.update(id, { name: 'Two' }, LATER, 1)).rejects.toMatchObject({
        name: 'StaleAggregateError',
        expected: 1,
        actual: 2,
      });
    });

    it('leaves the row alone when it refuses an update', async () => {
      const { contacts, customerId } = await makeRepo();
      const { id } = await seed(contacts, customerId);
      await contacts.update(id, { name: 'One' }, LATER, 1);

      await contacts.update(id, { name: 'Two' }, LATER, 1).catch(() => undefined);

      const after = await contacts.findById(id);
      expect(after?.name).toBe('One');
      expect(after?.lockVersion).toBe(2);
    });

    it('answers null for an update to a contact that does not exist', async () => {
      const { contacts } = await makeRepo();
      expect(await contacts.update(ID_1, { name: 'Nobody' }, LATER, 1)).toBeNull();
    });

    it('leaves the token and updatedAt alone for a patch that changes nothing', async () => {
      const { contacts, customerId } = await makeRepo();
      const { id } = await seed(contacts, customerId);

      const same = await contacts.update(id, {}, LATER, 1);

      expect(same?.lockVersion).toBe(1);

      expect(same?.updatedAt).toBe(NOW.toISOString());
    });

    it('removes the contact when the generation matches', async () => {
      const { contacts, customerId } = await makeRepo();
      const { id } = await seed(contacts, customerId);

      expect(await contacts.delete(id, 1)).toBe(true);
      expect(await contacts.findById(id)).toBeNull();
    });

    it('refuses a delete at a generation that has moved on, and keeps the row', async () => {
      const { contacts, customerId } = await makeRepo();
      const { id } = await seed(contacts, customerId);
      await contacts.update(id, { name: 'Corrected' }, LATER, 1);

      await expect(contacts.delete(id, 1)).rejects.toMatchObject({
        name: 'StaleAggregateError',
        expected: 1,
        actual: 2,
      });
      expect(await contacts.findById(id)).not.toBeNull();
    });

    it('answers false for a delete of a contact that does not exist', async () => {
      const { contacts } = await makeRepo();
      expect(await contacts.delete(ID_1, 1)).toBe(false);
    });
  });

  describe('a contact designated as it is created', () => {
    const ID_A = '01988a00-0003-7000-8000-0000000004a1';
    const ID_B = '01988a00-0003-7000-8000-0000000004a2';

    it('writes the roles with their provenance', async () => {
      const { contacts, customerId } = await makeRepo();

      const created = await contacts.create({
        id: ID_A,
        customerId,
        name: 'Buyer',
        email: 'buyer@example.com',
        createdAt: NOW,
        updatedAt: NOW,
        roles: mailRoles('system:first-contact', NOW),
      });

      expect(created.roles.map((role) => role.role)).toEqual([...MAIL_CONTACT_ROLES]);
      expect(created.roles.every((role) => role.setBy === 'system:first-contact')).toBe(true);
      expect(created.roles.every((role) => role.setAt === NOW.toISOString())).toBe(true);
    });

    it('leaves an ordinary create untagged', async () => {
      const { contacts, customerId } = await makeRepo();

      const created = await contacts.create({
        id: ID_A,
        customerId,
        name: 'Buyer',
        email: 'buyer@example.com',
        createdAt: NOW,
        updatedAt: NOW,
      });

      expect(created.roles).toEqual([]);
    });

    it('lets two contacts hold a role, and every read returns both', async () => {
      const { contacts, customerId } = await makeRepo();
      await contacts.create({
        id: ID_A,
        customerId,
        name: 'Buyer',
        email: 'buyer@example.com',
        createdAt: NOW,
        updatedAt: NOW,
        roles: mailRoles('system:first-contact', NOW),
      });

      const second = await contacts.create({
        id: ID_B,
        customerId,
        name: 'AP Clerk',
        email: 'ap@example.com',
        createdAt: LATER,
        updatedAt: LATER,
        roles: mailRoles('system:first-contact', LATER),
      });

      expect(second.roles.map((role) => role.role)).toEqual([...MAIL_CONTACT_ROLES]);

      const listed = await contacts.listByCustomer(customerId);
      const holders = listed.filter((c) =>
        c.roles.some((role) => role.role === 'order_confirmation'),
      );
      expect(holders.map((c) => c.id).sort()).toEqual([ID_A, ID_B].sort());
      expect((await contacts.findById(ID_A))?.roles.map((role) => role.role)).toEqual([
        ...MAIL_CONTACT_ROLES,
      ]);
      expect((await contacts.findById(ID_B))?.roles.map((role) => role.role)).toEqual([
        ...MAIL_CONTACT_ROLES,
      ]);

      const patched = await contacts.update(ID_B, { name: 'AP' }, LATER, second.lockVersion);
      expect(patched?.roles.map((role) => role.role)).toEqual([...MAIL_CONTACT_ROLES]);
    });
  });

  describe('giving up the designation with the address', () => {
    const ID_C = '01988a00-0003-7000-8000-0000000004b1';

    it('drops the mail roles in the same write as the address they needed', async () => {
      const { contacts, customerId } = await makeRepo();
      const created = await contacts.create({
        id: ID_C,
        customerId,
        name: 'Buyer',
        email: 'buyer@example.com',
        createdAt: NOW,
        updatedAt: NOW,
        roles: mailRoles('system:first-contact', NOW),
      });

      const cleared = await contacts.update(
        ID_C,
        { email: null, roles: [] },
        LATER,
        created.lockVersion,
      );

      expect(cleared?.email).toBeUndefined();
      expect(cleared?.roles).toEqual([]);
    });

    it('leaves the roles alone when the patch does not ask', async () => {
      const { contacts, customerId } = await makeRepo();
      const created = await contacts.create({
        id: ID_C,
        customerId,
        name: 'Buyer',
        email: 'buyer@example.com',
        createdAt: NOW,
        updatedAt: NOW,
        roles: mailRoles('system:first-contact', NOW),
      });

      const moved = await contacts.update(
        ID_C,
        { email: 'buyer.new@example.com' },
        LATER,
        created.lockVersion,
      );

      expect(moved?.roles.map((role) => role.role)).toEqual([...MAIL_CONTACT_ROLES]);
      expect(moved?.roles.every((role) => role.setBy === 'system:first-contact')).toBe(true);
    });
  });

  describe('the role set', () => {
    const ID_X = '01988a00-0003-7000-8000-0000000005a1';
    const ID_Y = '01988a00-0003-7000-8000-0000000005a2';

    async function twoReachable(contacts: ContactRepository, customerId: string) {
      await contacts.create({
        id: ID_X,
        customerId,
        name: 'Buyer',
        email: 'buyer@example.com',
        phone: '555-0157',
        createdAt: NOW,
        updatedAt: NOW,
      });
      await contacts.create({
        id: ID_Y,
        customerId,
        name: 'AP Clerk',
        email: 'ap@example.com',
        createdAt: NOW,
        updatedAt: NOW,
      });
    }

    it('holds several roles on one contact, in declaration order', async () => {
      const { contacts, customerId } = await makeRepo();
      await twoReachable(contacts, customerId);

      const tagged = await contacts.update(
        ID_X,
        {
          roles: [
            { role: 'production', setBy: 'dev-sales', setAt: NOW },
            { role: 'quote', setBy: 'dev-sales', setAt: NOW },
          ],
        },
        LATER,
        1,
      );

      expect(tagged?.roles.map((role) => role.role)).toEqual(['quote', 'production']);
    });

    it('lets several contacts share one role', async () => {
      const { contacts, customerId } = await makeRepo();
      await twoReachable(contacts, customerId);

      await contacts.update(
        ID_X,
        { roles: [{ role: 'quote', setBy: 'dev-sales', setAt: NOW }] },
        LATER,
        1,
      );
      await contacts.update(
        ID_Y,
        { roles: [{ role: 'quote', setBy: 'dev-sales', setAt: NOW }] },
        LATER,
        1,
      );

      const listed = await contacts.listByCustomer(customerId);
      const holders = listed.filter((c) => c.roles.some((role) => role.role === 'quote'));
      expect(holders.map((c) => c.id).sort()).toEqual([ID_X, ID_Y].sort());
    });

    it('replaces the whole set rather than adding to it', async () => {
      const { contacts, customerId } = await makeRepo();
      await twoReachable(contacts, customerId);
      const first = await contacts.update(
        ID_X,
        {
          roles: [
            { role: 'quote', setBy: 'dev-sales', setAt: NOW },
            { role: 'order_confirmation', setBy: 'dev-sales', setAt: NOW },
          ],
        },
        LATER,
        1,
      );

      const second = await contacts.update(
        ID_X,
        { roles: [{ role: 'order_confirmation', setBy: 'dev-billing', setAt: LATER }] },
        LATER,
        first?.lockVersion ?? 2,
      );

      expect(second?.roles.map((role) => role.role)).toEqual(['order_confirmation']);
    });

    it('keeps the provenance of a role it already held', async () => {
      const { contacts, customerId } = await makeRepo();
      await twoReachable(contacts, customerId);
      const first = await contacts.update(
        ID_X,
        { roles: [{ role: 'quote', setBy: 'dev-sales', setAt: NOW }] },
        LATER,
        1,
      );

      const second = await contacts.update(
        ID_X,
        {
          roles: [
            { role: 'quote', setBy: 'dev-billing', setAt: LATER },
            { role: 'order_confirmation', setBy: 'dev-billing', setAt: LATER },
          ],
        },
        LATER,
        first?.lockVersion ?? 2,
      );

      const quote = second?.roles.find((role) => role.role === 'quote');
      const confirmation = second?.roles.find((role) => role.role === 'order_confirmation');
      expect(quote?.setBy).toBe('dev-sales');
      expect(quote?.setAt).toBe(NOW.toISOString());
      expect(confirmation?.setBy).toBe('dev-billing');
    });

    it('counts a role change as a write, so the token moves', async () => {
      const { contacts, customerId } = await makeRepo();
      await twoReachable(contacts, customerId);

      const tagged = await contacts.update(
        ID_X,
        { roles: [{ role: 'quote', setBy: 'dev-sales', setAt: NOW }] },
        LATER,
        1,
      );

      expect(tagged?.lockVersion).toBe(2);
      await expect(contacts.update(ID_X, { roles: [] }, LATER, 1)).rejects.toThrow();
    });

    it('takes the role rows with the contact when it is deleted', async () => {
      const { contacts, customerId } = await makeRepo();
      await twoReachable(contacts, customerId);
      const tagged = await contacts.update(
        ID_X,
        { roles: [{ role: 'quote', setBy: 'dev-sales', setAt: NOW }] },
        LATER,
        1,
      );

      expect(await contacts.delete(ID_X, tagged?.lockVersion ?? 2)).toBe(true);

      const listed = await contacts.listByCustomer(customerId);
      expect(listed.some((c) => c.roles.length > 0)).toBe(false);
    });
  });
}
